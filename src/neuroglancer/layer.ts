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

import {Signal} from 'signals';
import {Disposable, RefCounted} from 'neuroglancer/util/disposable';
import {Uint64} from 'neuroglancer/util/uint64';
import {SpatialPosition} from 'neuroglancer/navigation_state';
import {Vec3, vec3, BoundingBox} from 'neuroglancer/util/geom';
import {addSignalBinding, removeSignalBinding, SignalBindingUpdater} from 'neuroglancer/util/signal_binding_updater';
import * as throttle from 'lodash/throttle';

export class RenderLayer extends RefCounted {
  ready = false;
  layerChanged = new Signal();
  readyStateChanged = new Signal();
  setReady(value: boolean) {
    this.ready = value;
    this.readyStateChanged.dispatch();
    this.layerChanged.dispatch();
  }

  handleAction(action: string) {
    // Do nothing by default.
  }

  getValueAt(x: Float32Array): any { return undefined; }

  voxelSize: Vec3 = null;
  boundingBox: BoundingBox = null;
};

export class UserLayer extends RefCounted {
  layersChanged = new Signal();
  readyStateChanged = new Signal();
  specificationChanged = new Signal();
  renderLayers = new Array<RenderLayer>();
  constructor(renderLayers: RenderLayer[] = []) {
    super();
    renderLayers.forEach(this.addRenderLayer.bind(this));
  }

  addRenderLayer(layer: RenderLayer) {
    this.renderLayers.push(layer);
    let {layersChanged, readyStateChanged} = this;
    this.registerDisposer(layer);
    this.registerSignalBinding(layer.layerChanged.add(layersChanged.dispatch, layersChanged));
    this.registerSignalBinding(
      layer.readyStateChanged.add(readyStateChanged.dispatch, readyStateChanged));
    layersChanged.dispatch();
  }

  getValueAt(position: Float32Array, pickedRenderLayer: RenderLayer, pickedObject: Uint64) {
    let result: any;
    let {renderLayers} = this;
    if (renderLayers.indexOf(pickedRenderLayer) !== -1) {
      return pickedObject;
    }
    for (let layer of renderLayers) {
      if (!layer.ready) {
        continue;
      }
      result = layer.getValueAt(position);
      if (result !== undefined) {
        break;
      }
    }
    return result;
  }

  toJSON (): any {
    return null;
  }

  makeDropdown(element: HTMLDivElement): Disposable|null { return null; }

  handleAction(action: string): void {}
};

export class ManagedUserLayer extends RefCounted {
  readyStateChanged = new Signal();
  layerChanged = new Signal();
  specificationChanged = new Signal();
  wasDisposed = false;
  private layer_: UserLayer = null;
  get layer() { return this.layer_; }

  private updateSignalBindings(layer: UserLayer, callback: SignalBindingUpdater) {
    callback(layer.layersChanged, this.handleLayerChanged, this);
    callback(layer.readyStateChanged, this.readyStateChanged.dispatch, this.readyStateChanged);
    callback(layer.specificationChanged, this.specificationChanged.dispatch, this.specificationChanged);
  }

  set layer(layer: UserLayer) {
    let oldLayer = this.layer_;
    if (oldLayer != null) {
      this.updateSignalBindings(oldLayer, removeSignalBinding);
    }
    this.layer_ = layer;
    if (layer != null) {
      this.updateSignalBindings(layer, addSignalBinding);
      this.readyStateChanged.dispatch();
      this.handleLayerChanged();
    }
  }
  constructor(public name: string, layer: UserLayer = null, public visible: boolean = true) {
    super();
    this.layer = layer;
  }
  private handleLayerChanged() {
    if (this.visible) {
      this.layerChanged.dispatch();
    }
  }
  setVisible(value: boolean) {
    if (value !== this.visible) {
      this.visible = value;
      this.layerChanged.dispatch();
    }
  }

  disposed () {
    this.wasDisposed = true;
  }
};

export class LayerManager extends RefCounted {
  managedLayers = new Array<ManagedUserLayer>();
  layersChanged = new Signal();
  readyStateChanged = new Signal();
  specificationChanged = new Signal();
  boundPositions = new WeakSet<SpatialPosition>();

  private updateSignalBindings(layer: ManagedUserLayer, callback: SignalBindingUpdater) {
    callback(layer.layerChanged, this.layersChanged.dispatch, this.layersChanged);
    callback(layer.readyStateChanged, this.readyStateChanged.dispatch, this.readyStateChanged);
    callback(layer.specificationChanged, this.specificationChanged.dispatch, this.specificationChanged);
  }

  /**
   * Assumes ownership of an existing reference to managedLayer.
   */
  addManagedLayer(managedLayer: ManagedUserLayer) {
    this.updateSignalBindings(managedLayer, addSignalBinding);
    this.managedLayers.push(managedLayer);
    this.layersChanged.dispatch();
    return managedLayer;
  }

  /**
   * Assumes ownership of an existing reference to userLayer.
   */
  addUserLayer(name: string, userLayer: UserLayer, visible: boolean) {
    let managedLayer = new ManagedUserLayer(name, userLayer, visible);
    return this.addManagedLayer(managedLayer);
  }

  * readyRenderLayers() {
    for (let managedUserLayer of this.managedLayers) {
      if (!managedUserLayer.visible || !managedUserLayer.layer) {
        continue;
      }
      for (let renderLayer of managedUserLayer.layer.renderLayers) {
        if (!renderLayer.ready) {
          continue;
        }
        yield renderLayer;
      }
    }
  }

  unbindManagedLayer(managedLayer: ManagedUserLayer) {
    this.updateSignalBindings(managedLayer, removeSignalBinding);
    managedLayer.dispose();
  }

  clear () {
    for (let managedLayer of this.managedLayers) {
      this.unbindManagedLayer(managedLayer);
    }
    this.managedLayers.length = 0;
    this.layersChanged.dispatch();
  }

  removeManagedLayer(managedLayer: ManagedUserLayer) {
    let index = this.managedLayers.indexOf(managedLayer);
    if (index === -1) {
      throw new Error(`Internal error: invalid managed layer.`);
    }
    this.unbindManagedLayer(managedLayer);
    this.managedLayers.splice(index, 1);
    this.layersChanged.dispatch();
  }

  reorderManagedLayer(oldIndex: number, newIndex: number) {
    const numLayers = this.managedLayers.length;
    if (oldIndex === newIndex || oldIndex < 0 || oldIndex >= numLayers || newIndex < 0 || newIndex >= numLayers) {
      // Don't do anything.
      return;
    }
    let [oldLayer] = this.managedLayers.splice(oldIndex, 1);
    this.managedLayers.splice(newIndex, 0, oldLayer);
    this.layersChanged.dispatch();
  }

  disposed() {
    this.clear();
  }

  getLayerByName(name: string) {
    return this.managedLayers.find(x => x.name === name);
  }

  /**
   * Asynchronously initialize the voxelSize and position based on the managed
   * layers.
   *
   * The first ready layer with an associated bounding box will set the position
   * to the center of the bounding box.
   */
  initializePosition(position: SpatialPosition) {
    if (position.valid) {
      // Nothing to do.
      return;
    }

    if (this.updatePositionFromLayers(position)) {
      return;
    }

    let {boundPositions} = this;
    if (boundPositions.has(position)) {
      return;
    }
    boundPositions.add(position);

    let handler = () => {
      this.updatePositionFromLayers(position);
      if (position.valid) {
        this.readyStateChanged.remove(handler);
        this.boundPositions.delete(position);
      }
    };
    this.readyStateChanged.add(handler);
  }

  updatePositionFromLayers(position: SpatialPosition) {
    if (position.valid) {
      return;
    }
    for (let managedLayer of this.managedLayers) {
      let userLayer = managedLayer.layer;
      if (userLayer == null) {
        continue;
      }
      for (let renderLayer of userLayer.renderLayers) {
        if (!renderLayer.ready) {
          continue;
        }
        if (!position.voxelSize.valid && renderLayer.voxelSize != null) {
          vec3.copy(position.voxelSize.size, renderLayer.voxelSize);
          position.voxelSize.setValid();
        }

        if (!position.spatialCoordinatesValid && !position.voxelCoordinatesValid &&
            renderLayer.boundingBox != null) {
          let boundingBox = renderLayer.boundingBox;
          let centerPosition = vec3.create();
          vec3.add(centerPosition, boundingBox.lower, boundingBox.upper);
          vec3.scale(centerPosition, centerPosition, 0.5);
          position.setVoxelCoordinates(centerPosition);
        }
      }
    }
  }

  get renderLayers() {
    let layerManager = this;
    return {
      * [Symbol.iterator]() {
          for (let managedLayer of layerManager.managedLayers) {
            for (let renderLayer of managedLayer.layer.renderLayers) {
              yield renderLayer;
            }
          }
        }
    };
  }

  get visibleRenderLayers() {
    let layerManager = this;
    return {
      * [Symbol.iterator]() {
          for (let managedLayer of layerManager.managedLayers) {
            if (!managedLayer.visible) {
              continue;
            }
            for (let renderLayer of managedLayer.layer.renderLayers) {
              yield renderLayer;
            }
          }
        }
    };
  }

  invokeAction(action: string) {
    for (let managedLayer of this.managedLayers) {
      if (!managedLayer.visible) {
        continue;
      }
      let userLayer = managedLayer.layer;
      userLayer.handleAction(action);
      for (let renderLayer of userLayer.renderLayers) {
        if (!renderLayer.ready) {
          continue;
        }
        renderLayer.handleAction(action);
      }
    }
  }
};

const MOUSE_STATE_UPDATE_INTERVAL = 50;

export class MouseSelectionState {
  changed = new Signal();
  position = vec3.create();
  active = false;
  pickedRenderLayer: RenderLayer = null;
  pickedValue = new Uint64(0, 0);

  updater: (mouseState: MouseSelectionState) => boolean;

  stale = false;

  triggerUpdate = throttle(
      () => { this.update(); }, MOUSE_STATE_UPDATE_INTERVAL, {leading: true, trailing: true});

  updateUnconditionally() {
    this.triggerUpdate.cancel();
    this.update();
    return this.active;
  }

  updateIfStale() {
    if (this.stale) {
      this.update();
    }
  }

  private update() {
    let {updater} = this;
    this.stale = false;
    if (!updater) {
      this.setActive(false);
    } else {
      this.setActive(updater(this));
    }
  }

  setActive(value: boolean) {
    this.stale = false;
    if (this.active !== value || value === true) {
      this.active = value;
      this.changed.dispatch();
    }
  }
};

export class LayerSelectedValues extends RefCounted {
  values = new Map<UserLayer, any>();
  changed = new Signal();
  needsUpdate = true;
  constructor(public layerManager: LayerManager, public mouseState: MouseSelectionState) {
    super();
    this.registerSignalBinding(mouseState.changed.add(this.handleChange, this));
    this.registerSignalBinding(layerManager.layersChanged.add(() => { this.handleLayerChange(); }));
  }

  /**
   * This should be called when the layer data may have changed, due to the set of managed layers
   * changing or new data having been received.
   */
  handleLayerChange() {
    if (this.mouseState.active) {
      this.handleChange();
    }
  }

  handleChange() {
    this.needsUpdate = true;
    this.changed.dispatch();
  }

  update() {
    if (!this.needsUpdate) {
      return;
    }
    this.needsUpdate = false;
    let values = this.values;
    let mouseState = this.mouseState;
    values.clear();
    if (mouseState.active) {
      let position = mouseState.position;
      for (let layer of this.layerManager.managedLayers) {
        let userLayer = layer.layer;
        if (layer.visible && userLayer) {
          values.set(
              userLayer,
              userLayer.getValueAt(position, mouseState.pickedRenderLayer, mouseState.pickedValue));
        }
      }
    }
  }

  get(userLayer: UserLayer) {
    this.update();
    return this.values.get(userLayer);
  }
};

export class VisibleRenderLayerTracker<RenderLayerType extends RenderLayer> extends RefCounted {

  private visibleLayers = new Set<RenderLayerType>();
  private newVisibleLayers = new Set<RenderLayerType>();
  private updatePending: number|null = null;

  constructor(public layerManager: LayerManager, public renderLayerType: any,
              private layerAdded: (layer: RenderLayerType) => void,
              private layerRemoved: (layer: RenderLayerType) => void) {
    super();
    this.registerSignalBinding(layerManager.layersChanged.add(this.handleLayersChanged, this));
    this.updateVisibleLayers();
  }

  private handleLayersChanged() {
    if (this.updatePending === null) {
      this.updatePending = setTimeout(() => {
        this.updatePending = null;
        this.updateVisibleLayers();
      }, 0);
    }
  }

  disposed () {
    this.cancelUpdate();
    this.visibleLayers.forEach(this.layerRemoved);
    this.visibleLayers.clear();
  }

  private cancelUpdate () {
    let {updatePending} = this;
    if (updatePending !== null) {
      clearTimeout(updatePending);
      updatePending = null;
    }
  }

  private updateVisibleLayers () {
    let {visibleLayers, newVisibleLayers, renderLayerType, layerAdded, layerRemoved} = this;
    for (let renderLayer of this.layerManager.readyRenderLayers()) {
      if (renderLayer instanceof renderLayerType) {
        let typedLayer = <RenderLayerType>renderLayer;
        newVisibleLayers.add(typedLayer);
        if (!visibleLayers.has(typedLayer)) {
          visibleLayers.add(typedLayer);
          layerAdded(typedLayer);
        }
      }
    }
    for (let renderLayer of visibleLayers) {
      if (!newVisibleLayers.has(renderLayer)) {
        visibleLayers.delete(renderLayer);
        layerRemoved(renderLayer);
      }
    }
    newVisibleLayers.clear();
  }

  getVisibleLayers () {
    if (this.updatePending !== null) {
      this.cancelUpdate();
      this.updateVisibleLayers();
    }
    return this.visibleLayers;
  }
};
