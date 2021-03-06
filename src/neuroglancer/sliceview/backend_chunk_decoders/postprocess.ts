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

/**
 * Converts raw data volumes to the appropriate format required by the frontend.
 */

import {DataType} from 'neuroglancer/sliceview/base';
import {VolumeChunk} from 'neuroglancer/sliceview/backend';
import {Uint32ArrayBuilder} from 'neuroglancer/util/uint32array_builder.ts';
import {encodeChannel as encodeChannelUint32} from 'neuroglancer/sliceview/compressed_segmentation/encode_uint32';
import {encodeChannel as encodeChannelUint64} from 'neuroglancer/sliceview/compressed_segmentation/encode_uint64';

const tempBuffer = new Uint32ArrayBuilder(20000);

export function postProcessRawData(chunk: VolumeChunk, data: ArrayBufferView) {
  const {spec} = chunk.source;
  if (spec.compressedSegmentationBlockSize) {
    const {dataType} = spec;
    tempBuffer.clear();
    switch (dataType) {
    case DataType.UINT32:
      encodeChannelUint32(tempBuffer, spec.compressedSegmentationBlockSize, <Uint32Array>data, chunk.chunkDataSize);
      break;
    case DataType.UINT64:
      encodeChannelUint64(tempBuffer, spec.compressedSegmentationBlockSize, <Uint32Array>data, chunk.chunkDataSize);
      break;
    default:
      throw new Error(`Unsupported data type for compressed segmentation: ${DataType[dataType]}`);
    }
    chunk.data = new Uint32Array(tempBuffer.view);
  } else {
    chunk.data = data;
  }
}
