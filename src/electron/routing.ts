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

import * as net from 'net';
import * as os from 'os';

const isLinux = os.platform() === 'linux';

interface RoutingServiceRequest {
  action: string;
  parameters: {[parameter: string]: string|boolean};
}

interface RoutingServiceResponse {
  action: RoutingServiceAction;  // Matches RoutingServiceRequest.action
  statusCode: RoutingServiceStatusCode;
  errorMessage?: string;
  connectionStatus: ConnectionStatus;
}

export enum RoutingServiceAction {
  CONFIGURE_ROUTING = 'configureRouting',
  RESET_ROUTING = 'resetRouting',
  GET_DEVICE_NAME = 'getDeviceName',
  STATUS_CHANGED = 'statusChanged'
}

enum RoutingServiceStatusCode {
  SUCCESS = 0,
  GENERIC_FAILURE = 1,
  UNSUPPORTED_ROUTING_TABLE = 2
}

const SERVICE_NAME =
    os.platform() === 'win32' ? '\\\\.\\pipe\\OutlineServicePipe' : '/var/run/outline_controller';

export class RoutingService {
  static create(onClose: () => void, onMessage: (type: RoutingServiceAction) => void):
      Promise<RoutingService> {
    return new Promise((F, R) => {
      // TODO: timeouts? how long does the service typically take to restart?
      const conn = net.createConnection(SERVICE_NAME, () => {
        F(new RoutingService(conn, onClose, onMessage));
      });
      // is sufficient to detect failure (no need to listen for end, etc.)
      conn.once('error', () => {
        R(new Error('could not connect'));
      });
    });
  }

  private tunDeviceName = 'yoyoyo';

  private constructor(
      private conn: net.Socket, private onClose: () => void,
      onMessage: (type: RoutingServiceAction) => void) {
    // once this happens, all further calls to this RoutingService instance will fail
    // NOTE: close is called after error
    conn.once('close', () => {
      this.conn.removeAllListeners();
      this.onClose();
    });

    // TODO: is it ever split over multiple packets?
    this.conn.on('data', (data) => {
      if (!data) {
        // TODO: huh?
        return;
      }

      console.log(`data from pipe: ${data}`);
      // TODO: check type
      const res: RoutingServiceResponse = JSON.parse(data.toString());

      onMessage(res.action);

      // switch (res.action) {
      //   // case RoutingServiceAction.GET_DEVICE_NAME:
      //   //   // TODO: OMFG untyped fields
      //   //   this.tunDeviceName = (res as any)['returnValue'];
      //   //   this.doit();
      //   //   break;
      //   case RoutingServiceAction.CONFIGURE_ROUTING:
      //   onMessage();
      //     break;
      //   case RoutingServiceAction.RESET_ROUTING:
      //     break;
      //   default:
      //     // TODO: uh
      // }
    });
  }

  start(): void {
    console.log(`asking service to configure routing: ${this.tunDeviceName}`);
    this.conn.write(JSON.stringify({
      // action: RoutingServiceAction.CONFIGURE_ROUTING,
      action: RoutingServiceAction.RESET_ROUTING,
      parameters: {'proxyIp': '1.1.1.1', 'routerIp': '10.0.85.1', 'isAutoConnect': false}
    }));
  }
}

// // Restores the default system routes.
// resetRouting(): Promise<string> {
//   try {
//     if (this.ipcConnection) {
//       this.ipcConnection.removeAllListeners();
//     }
//   } catch (e) {
//     // Ignore, the service may have disconnected the pipe.
//   }
//   return this.sendRequest({action: RoutingServiceAction.RESET_ROUTING, parameters: {}});
// }
// }
