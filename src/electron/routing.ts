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
  private pipe?: net.Socket;

  private statusListener?: () => void;

  setStatusListener(listener: () => void): void {
    this.statusListener = listener;
  }

  private async getConnection(): Promise<net.Socket> {
    if (this.pipe) {
      console.log('already connected to pipe');
      return this.pipe;
    }

    return new Promise<net.Socket>((F, R) => {
      console.log('connecting to pipe...');

      // TODO: timeout? how long does the service typically take to restart?
      const pipe = net.createConnection(SERVICE_NAME, () => {
        console.log('connected to pipe!');
        this.pipe = pipe;
        F(pipe);
      });

      // is sufficient to detect failure (no need to listen for end, etc.)
      pipe.once('error', () => {
        // console.error('pipe error');
        R(new Error('could not connect to pipe'));
      });

      // NOTE: close is called after error
      pipe.once('close', () => {
        console.log('pipe closed');
        if (this.pipe) {
          this.pipe.removeAllListeners();
        }
        this.pipe = undefined;
        if (this.statusListener) {
          this.statusListener();
        }
      });

      pipe.on('data', (data) => {
        console.log(`received message from pipe: ${data.toString().trim()}`);
        const res: RoutingServiceResponse = JSON.parse(data.toString());
        switch (res.action) {
          case RoutingServiceAction.CONFIGURE_ROUTING:
            if (this.fulfillStart) {
              this.fulfillStart();
            }
            break;
          case RoutingServiceAction.RESET_ROUTING:
            if (this.fulfillStop) {
              this.fulfillStop();
            }
            pipe.end();
            break;
        }
      });
    });
  }

  private fulfillStart?: () => void;
  private fulfillStop?: () => void;

  // ALWAYS USES A BRAND NEW PIPE
  async start(host: string) {
    const pipe = await this.getConnection();
    pipe.write(JSON.stringify({
      action: RoutingServiceAction.CONFIGURE_ROUTING,
      parameters: {'proxyIp': host, 'routerIp': '10.0.85.1', 'isAutoConnect': false}
    }));
    return new Promise<void>((F) => {
      this.fulfillStart = F;
    });
  }

  // REUSES CURRENT PIPE, IF ONE EXISTS
  async stop() {
    const pipe = this.pipe || await this.getConnection();
    pipe.write(JSON.stringify({action: RoutingServiceAction.RESET_ROUTING, parameters: {}}));
    return new Promise<void>((F) => {
      this.fulfillStop = F;
    });
  }
}
