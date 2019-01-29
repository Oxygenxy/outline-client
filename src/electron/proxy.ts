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

import * as process_manager from './process_manager';
import {pathToEmbeddedBinary} from './util';

export class SsLocal {
  private readonly process =
      new process_manager.SingletonProcess(pathToEmbeddedBinary('shadowsocks-libev', 'ss-local'));

  constructor(private readonly proxyPort: number) {}

  setStatusListener(listener?: () => void): void {
    this.process.setStatusListener(listener);
  }

  start(config: cordova.plugins.outline.ServerConfig) {
    // ss-local -s x.x.x.x -p 65336 -k mypassword -m aes-128-cfb -l 1081 -u
    const args = ['-l', this.proxyPort.toString()];
    args.push('-s', config.host || '');
    args.push('-p', '' + config.port);
    args.push('-k', config.password || '');
    args.push('-m', config.method || '');
    args.push('-t', '5');
    args.push('-u');

    this.process.start(args);
  }

  stop() {
    this.process.stop();
  }
}
