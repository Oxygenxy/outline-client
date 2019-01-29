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

export class SingletonProcess {
  private process?: ChildProcess;

  constructor(private path: string) {}

  private statusListener?: () => void;

  setStatusListener(listener?: () => void): void {
    this.statusListener = listener;
  }

  start(args: string[]) {
    // TODO: check if already running
    this.process = spawn(this.path, args);

    this.process.on('error', (e) => {
      console.error('process errored');
      this.process = undefined;
      if (this.statusListener) {
        this.statusListener();
      }
    });

    // May not fire if the process failed to launch!
    this.process.on('exit', (code, signal) => {
      console.log('process exited');
      this.process = undefined;
      if (this.statusListener) {
        this.statusListener();
      }
    });
  }

  stop() {
    if (this.process) {
      this.process.kill();
    }
  }
}
