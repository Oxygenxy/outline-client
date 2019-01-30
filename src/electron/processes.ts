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

import {ChildProcess, spawn} from 'child_process';
import {platform} from 'os';

import {pathToEmbeddedBinary} from './util';

const isLinux = platform() === 'linux';

const TUN2SOCKS_TAP_DEVICE_NAME = isLinux ? 'outline-tun0' : 'outline-tap0';
const TUN2SOCKS_TAP_DEVICE_IP = '10.0.85.2';
const TUN2SOCKS_VIRTUAL_ROUTER_IP = '10.0.85.1';
const TUN2SOCKS_TAP_DEVICE_NETWORK = '10.0.85.0';
const TUN2SOCKS_VIRTUAL_ROUTER_NETMASK = '255.255.255.0';

export interface HelperProcess {
  setExitListener(newListener?: () => void): void;
  // Although not all classes need the config, a common interface greatly facilitates testing.
  go(config: cordova.plugins.outline.ServerConfig): void;
  stop(): void;
}

// Subclasses must implement go().
class HelperProcessSkeleton {
  private process?: ChildProcess;

  constructor(private path: string) {}

  private exitListener?: () => void;

  setExitListener(newListener?: () => void): void {
    this.exitListener = newListener;
  }

  // Note that there is *no way* to tell whether a process was launched successfully: callers should
  // assume the process was launched successfully until they receive an exit message, which may
  // happen immediately after calling this function.
  //
  // TODO: rename
  // TODO: check if already running?
  protected start(args: string[]) {
    this.process = spawn(this.path, args);

    const onExit = () => {
      if (this.process) {
        this.process.removeAllListeners();
        this.process = undefined;
      }
      if (this.exitListener) {
        this.exitListener();
      }
    };

    // Listen for both: error is failure to launch, exit may not be invoked in that case.
    this.process.on('error', onExit.bind((this)));
    this.process.on('exit', onExit.bind((this)));
  }

  stop() {
    if (this.process) {
      this.process.kill();
    }
  }
}

export class SsLocal extends HelperProcessSkeleton implements HelperProcess {
  constructor(private readonly proxyPort: number) {
    super(pathToEmbeddedBinary('shadowsocks-libev', 'ss-local'));
  }

  go(config: cordova.plugins.outline.ServerConfig) {
    // ss-local -s x.x.x.x -p 65336 -k mypassword -m aes-128-cfb -l 1081 -u
    const args = ['-l', this.proxyPort.toString()];
    args.push('-s', config.host || '');
    args.push('-p', '' + config.port);
    args.push('-k', config.password || '');
    args.push('-m', config.method || '');
    args.push('-t', '5');
    args.push('-u');

    super.start(args);
  }
}

// TODO: handle suspend/resume
export class Tun2socks extends HelperProcessSkeleton implements HelperProcess {
  constructor(private proxyAddress: string, private proxyPort: number) {
    super(pathToEmbeddedBinary('badvpn', 'badvpn-tun2socks'));
  }

  go() {
    // ./badvpn-tun2socks.exe \
    //   --tundev "tap0901:outline-tap0:10.0.85.2:10.0.85.0:255.255.255.0" \
    //   --netif-ipaddr 10.0.85.1 --netif-netmask 255.255.255.0 \
    //   --socks-server-addr 127.0.0.1:1081 \
    //   --socks5-udp --udp-relay-addr 127.0.0.1:1081 \
    //   --transparent-dns
    const args: string[] = [];
    args.push(
        '--tundev',
        isLinux ? TUN2SOCKS_TAP_DEVICE_NAME :
                  `tap0901:${TUN2SOCKS_TAP_DEVICE_NAME}:${TUN2SOCKS_TAP_DEVICE_IP}:${
                      TUN2SOCKS_TAP_DEVICE_NETWORK}:${TUN2SOCKS_VIRTUAL_ROUTER_NETMASK}`);
    args.push('--netif-ipaddr', TUN2SOCKS_VIRTUAL_ROUTER_IP);
    args.push('--netif-netmask', TUN2SOCKS_VIRTUAL_ROUTER_NETMASK);
    args.push('--socks-server-addr', `${this.proxyAddress}:${this.proxyPort}`);
    args.push('--loglevel', 'error');
    args.push('--transparent-dns');
    // TODO: make conditional
    args.push('--socks5-udp');
    args.push('--udp-relay-addr', `${this.proxyAddress}:${this.proxyPort}`);

    super.start(args);
  }
}
