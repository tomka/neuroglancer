/**
 * @license
 * Copyright 2016 Google Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {RPC, SharedObjectCounterpart, registerSharedObject, registerRPC} from 'neuroglancer/worker_rpc';
import {HashTable} from 'neuroglancer/gpu_hash/hash_table';
import {Signal} from 'signals';
import {Uint64} from 'neuroglancer/util/uint64';

export class Uint64Set extends SharedObjectCounterpart {
  hashTable = new HashTable();
  changed = new Signal();

  initializeCounterpart(rpc: RPC, options: any = {}) {
    options['type'] = 'Uint64Set';
    super.initializeCounterpart(rpc, options);
  }

  static makeWithCounterpart(rpc: RPC) {
    let obj = new Uint64Set();
    obj.initializeCounterpart(rpc);
    return obj;
  }

  disposed () {
    super.disposed();
    this.hashTable = null;
    this.changed = null;
  }

  add_(x: Uint64) {
    return this.hashTable.add(x.low, x.high);
  }

  add (x: Uint64) {
    if (this.add_(x)) {
      let {rpc} = this;
      if (rpc) {
        rpc.invoke('Uint64Set.add', {'id': this.rpcId, 'value': x});
      }
      this.changed.dispatch(x, true);
    }
  }

  has (x: Uint64) {
    return this.hashTable.has(x.low, x.high);
  }

  *[Symbol.iterator]() {
    let temp = new Uint64();
    for (let x of this.hashTable[Symbol.iterator]()) {
      temp.low = x[0];
      temp.high = x[1];
      yield temp;
    }
  }

  delete_(x: Uint64) {
    return this.hashTable.delete(x.low, x.high);
  }

  delete(x: Uint64) {
    if (this.delete_(x)) {
      let {rpc} = this;
      if (rpc) {
        rpc.invoke('Uint64Set.delete', {'id': this.rpcId, 'value': x});
      }
      this.changed.dispatch(x, false);
    }
  }

  get size () {
    return this.hashTable.size;
  }

  clear() {
    if (this.hashTable.clear()) {
      let {rpc} = this;
      if (rpc) {
        rpc.invoke('Uint64Set.clear', {'id': this.rpcId});
      }
      this.changed.dispatch(null, false);
    }
  }
};

registerRPC('Uint64Set.add', function (x) {
  let obj = this.get(x['id']);
  if (obj.add_(x['value'])) {
    obj.changed.dispatch();
  }
});

registerRPC('Uint64Set.delete', function (x) {
  let obj = this.get(x['id']);
  if (obj.delete_(x['value'])) {
    obj.changed.dispatch();
  }
});

registerRPC('Uint64Set.clear', function (x) {
  let obj = this.get(x['id']);
  if (obj.hashTable.clear()) {
    obj.changed.dispatch();
  }
});

registerSharedObject('Uint64Set', Uint64Set);
