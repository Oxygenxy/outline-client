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

import {SsLocal} from './proxy';
import * as routing from './routing';
import {Tun2socks} from './tun2socks';

const PROXY_ADDRESS = '127.0.0.1';
const PROXY_PORT = 1081;

export class Mediator {
  private r = new routing.RoutingService();
  private p = new SsLocal(PROXY_PORT);
  private t = new Tun2socks(PROXY_ADDRESS, PROXY_PORT);

  // ugh horrible
  private currentId: string|undefined;

  private listener?: (status: ConnectionStatus, connectionId: string) => void;

  setListener(listener: (status: ConnectionStatus, connectionId: string) => void) {
    this.listener = listener;
  }

  // TODO: stop if already started!
  async start(config: cordova.plugins.outline.ServerConfig, id: string) {
    console.log('mediator: starting processes...');
    this.currentId = id;
    await this.r.start(config.host || '');
    this.p.setStatusListener(this.failure.bind(this));
    this.t.setStatusListener(this.failure.bind(this));
    this.t.start();
    this.p.start(config);
  }

  private failure() {
    console.error('mediator: something failed');
    this.stop();
  }

  async stop() {
    console.log('mediator: stopping processes...');
    this.p.setStatusListener(undefined);
    this.t.setStatusListener(undefined);
    await this.r.stop();
    this.p.stop();
    this.t.stop();

    if (this.listener && this.currentId) {
      this.listener(ConnectionStatus.DISCONNECTED, this.currentId);
    }
  }
}
