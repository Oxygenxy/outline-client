// Copyright 2018 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as sentry from '@sentry/electron';
import {app, BrowserWindow, ipcMain, Menu, MenuItemConstructorOptions, nativeImage, shell, Tray} from 'electron';
import * as promiseIpc from 'electron-promise-ipc';
import {autoUpdater} from 'electron-updater';
import * as os from 'os';
import * as path from 'path';
import * as process from 'process';
import * as url from 'url';
import autoLaunch = require('auto-launch'); // tslint:disable-line

import * as errors from '../www/model/errors';

import {ConnectionStore, SerializableConnection} from './connection_store';
import * as process_manager from './process_manager';
import * as routing from './routing';

// Used for the auto-connect feature. There will be a connection in store
// if the user was connected at shutdown.
const connectionStore = new ConnectionStore(app.getPath('userData'));

const isLinux = os.platform() === 'linux';

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow: Electron.BrowserWindow|null;

let tray: Tray;
let isAppQuitting = false;
// Default to English strings in case we fail to retrieve them from the renderer process.
let localizedStrings: {[key: string]: string} = {
  'connected-server-state': 'Connected',
  'disconnected-server-state': 'Disconnected',
  'quit': 'Quit'
};

const debugMode = process.env.OUTLINE_DEBUG === 'true';

const trayIconImages = {
  connected: createTrayIconImage('connected.png'),
  disconnected: createTrayIconImage('disconnected.png')
};

const enum Options {
  AUTOSTART = '--autostart'
}

function createWindow(connectionAtShutdown?: SerializableConnection) {
  // Create the browser window.
  mainWindow = new BrowserWindow({width: 360, height: 640, resizable: false});

  const pathToIndexHtml = path.join(app.getAppPath(), 'www', 'electron_index.html');
  const webAppUrl = new url.URL(`file://${pathToIndexHtml}`);

  // Debug mode, etc.
  const queryParams = new url.URLSearchParams();
  if (debugMode) {
    queryParams.set('debug', 'true');
  }
  webAppUrl.search = queryParams.toString();

  const webAppUrlAsString = webAppUrl.toString();

  console.info(`loading web app from ${webAppUrlAsString}`);
  mainWindow.loadURL(webAppUrlAsString);

  // Emitted when the window is closed.
  mainWindow.on('closed', () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });

  const minimizeWindowToTray = (event: Event) => {
    if (!mainWindow || isAppQuitting) {
      return;
    }
    event.preventDefault();  // Prevent the app from exiting on the 'close' event.
    mainWindow.hide();
  };
  mainWindow.on('minimize', minimizeWindowToTray);
  mainWindow.on('close', minimizeWindowToTray);

  // TODO: is this the most appropriate event?
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow!.webContents.send('localizationRequest', Object.keys(localizedStrings));
    interceptShadowsocksLink(process.argv);
    if (connectionAtShutdown) {
      const serverId = connectionAtShutdown.id;
      console.info(`Automatically starting connection ${serverId}`);
      sendConnectionStatus(ConnectionStatus.RECONNECTING, serverId);
      // TODO: Handle errors, report.
      startVpn(connectionAtShutdown.config, serverId, true);
    }
  });

  // The client is a single page app - loading any other page means the
  // user clicked on one of the Privacy, Terms, etc., links. These should
  // open in the user's browser.
  mainWindow.webContents.on('will-navigate', (event: Event, url: string) => {
    shell.openExternal(url);
    event.preventDefault();
  });
}

function createTrayIcon(status: ConnectionStatus) {
  const isConnected = status === ConnectionStatus.CONNECTED;
  const trayIconImage = isConnected ? trayIconImages.connected : trayIconImages.disconnected;
  if (tray) {
    tray.setImage(trayIconImage);
  } else {
    tray = new Tray(trayIconImage);
    tray.on('click', () => {
      if (!mainWindow) {
        createWindow();
        return;
      }
      if (mainWindow.isMinimized() || !mainWindow.isVisible()) {
        mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      } else {
        mainWindow.hide();
      }
    });
    tray.setToolTip('Outline');
  }
  // Retrieve localized strings, falling back to the pre-populated English default.
  const statusString = isConnected ? localizedStrings['connected-server-state'] :
                                     localizedStrings['disconnected-server-state'];
  const quitString = localizedStrings['quit'];
  const menuTemplate = [
    {label: statusString, enabled: false}, {type: 'separator'} as MenuItemConstructorOptions,
    {label: quitString, click: quitApp}
  ];
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
}

function createTrayIconImage(imageName: string) {
  const image =
      nativeImage.createFromPath(path.join(app.getAppPath(), 'resources', 'tray', imageName));
  if (image.isEmpty()) {
    throw new Error(`cannot find ${imageName} tray icon image`);
  }
  return image;
}

// Signals that the app is quitting and quits the app. This is necessary because we override the
// window 'close' event to support minimizing to the system tray.
function quitApp() {
  isAppQuitting = true;
  app.quit();
}

const isSecondInstance = app.makeSingleInstance((argv, workingDirectory) => {
  interceptShadowsocksLink(argv);

  // Someone tried to run a second instance, we should focus our window.
  if (mainWindow) {
    if (mainWindow.isMinimized() || !mainWindow.isVisible()) {
      mainWindow.restore();
      mainWindow.show();
    }
    mainWindow.focus();
  }
});

if (isSecondInstance) {
  quitApp();
}

app.setAsDefaultProtocolClient('ss');

function interceptShadowsocksLink(argv: string[]) {
  if (argv.length > 1) {
    const protocol = 'ss://';
    let url = argv[1];
    if (url.startsWith(protocol)) {
      if (mainWindow) {
        // The system adds a trailing slash to the intercepted URL (before the fragment).
        // Remove it before sending to the UI.
        url = `${protocol}${url.substr(protocol.length).replace(/\//g, '')}`;
        mainWindow.webContents.send('add-server', url);
      } else {
        console.error('called with URL but mainWindow not open');
      }
    }
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  if (debugMode) {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{
      label: 'Developer',
      submenu: [{role: 'reload'}, {role: 'forcereload'}, {role: 'toggledevtools'}]
    }]));
  } else {
    // TODO: Run this periodically, e.g. every 4-6 hours.
    try {
      autoUpdater.checkForUpdates();
    } catch (e) {
      console.error(`Failed to check for updates`, e);
    }
  }

  // Set the app to launch at startup to connect automatically in case of a showdown while proxying.
  if (isLinux) {
    if (process.env.APPIMAGE) {
      const outlineAutoLauncher = new autoLaunch({
        name: 'OutlineClient',
        path: process.env.APPIMAGE,
      });

      outlineAutoLauncher.isEnabled()
          .then((isEnabled: boolean) => {
            if (isEnabled) {
              return;
            }
            outlineAutoLauncher.enable();
          })
          .catch((err: Error) => {
            console.error(`failed to add autolaunch entry for Outline ${err.message}`);
          });
    }
  } else {
    app.setLoginItemSettings({openAtLogin: true, args: [Options.AUTOSTART]});
  }

  // because autostart doesn't work for linux then we just assume we
  // are auto started on linux
  if (process.argv.includes(Options.AUTOSTART)) {
    connectionStore.load()
        .then((connection) => {
          // The user was connected at shutdown. Create the main window and wait for the UI ready
          // event to start the VPN.
          createWindow(connection);
        })
        .catch((err) => {
          // The user was not connected at shutdown.
          // Quitting the app will reset the system proxy configuration before exiting.
          console.log('The user was not connected at shutdown.');
        });
  } else {
    createWindow();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('quit', () => {
  process_manager.teardownVpn().catch((e) => {
    console.error(`could not tear down proxy on exit`, e);
  });
});

promiseIpc.on('is-reachable', (config: cordova.plugins.outline.ServerConfig) => {
  return process_manager.isServerReachable(config)
      .then(() => {
        return true;
      })
      .catch((e) => {
        return false;
      });
});

// used by both "regular", user-initiated connect and auto-connect (on startup/boot).
function startVpn(config: cordova.plugins.outline.ServerConfig, id: string, isAutoConnect = false) {
  // don't log connection details (PII)
  console.log('frontend asked us to connect!');

  // connect to service, via unix pipe
  // NOTE: on windows, nobody else can connect to the pipe until the client
  //       disconnects from the pipe - NOT EVEN THE CONNECTED CLIENT
  // TODO: does this mean if the client crashes while you're connected, the new
  //       instance of the client CANNOT connect to the pipe?
  routing.RoutingService
      .create(
          () => {
            // TODO: reconnect?
            // TODO: when does the service close the pipe? is it different on windows vs. linux?
            // TODO: should we just abort when the pipe closes?
            console.log('pipe to service closed!');
          },
          (type) => {
            console.log(`service message: ${type}`);
            // TODO: start shadowsocks, etc. when this happens?
            if (type === routing.RoutingServiceAction.CONFIGURE_ROUTING) {
              console.log(`connected! disconnecting...`);
              // TODO: uh damn
              // r.stop();
            }
          })
      .then(
          (r) => {
            // TODO: how to keep a reference to this for when/if disconnect is called?
            console.log('connected to service');
            r.start();
          },
          (e) => {
            // TODO: start/install the service?
            console.error('could not connect to pipe');
          });
}

function sendConnectionStatus(status: ConnectionStatus, connectionId: string) {
  let statusString;
  switch (status) {
    case ConnectionStatus.CONNECTED:
      statusString = 'connected';
      break;
    case ConnectionStatus.DISCONNECTED:
      statusString = 'disconnected';
      break;
    case ConnectionStatus.RECONNECTING:
      statusString = 'reconnecting';
      break;
    default:
      console.error(`Cannot send unknown proxy status: ${status}`);
      return;
  }
  const event = `proxy-${statusString}-${connectionId}`;
  if (mainWindow) {
    mainWindow.webContents.send(event);
  } else {
    console.warn(`received ${event} event but no mainWindow to notify`);
  }
}

// TODO: does this have to be a promise? could we do events instead?
promiseIpc.on(
    'start-proxying', (args: {config: cordova.plugins.outline.ServerConfig, id: string}) => {
      startVpn(args.config, args.id);
      throw errors.ErrorCode.SHADOWSOCKS_START_FAILURE;
    });

promiseIpc.on('stop-proxying', () => {
  return process_manager.teardownVpn();
});

// This event fires whenever the app's window receives focus.
app.on('browser-window-focus', () => {
  if (mainWindow) {
    mainWindow.webContents.send('push-clipboard');
  }
});

// Error reporting.
// This config makes console (log/info/warn/error - no debug!) output go to breadcrumbs.
ipcMain.on('environment-info', (event: Event, info: {appVersion: string, dsn: string}) => {
  sentry.init({dsn: info.dsn, release: info.appVersion, maxBreadcrumbs: 100});
  // To clearly identify app restarts in Sentry.
  console.info(`Outline is starting`);
});

ipcMain.on('quit-app', quitApp);

ipcMain.on('localizationResponse', (event: Event, localizationResult: {[key: string]: string}) => {
  if (!!localizationResult) {
    localizedStrings = localizationResult;
  }
  createTrayIcon(ConnectionStatus.DISCONNECTED);
});

// Notify the UI of updates.
autoUpdater.on('update-downloaded', (ev, info) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-downloaded');
  }
});
