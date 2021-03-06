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

'use strict';

let nunjucks = require('nunjucks');
let fs = require('fs');
let path = require('path');

let rootDir = path.join(__dirname, '..');

let env = nunjucks.configure(rootDir, {
  autoescape: false,
  tags: {
    blockStart: '/*%',
    blockEnd: '%*/',
    variableStart: '/*@',
    variableEnd: '@*/',
  }
});

function writeSegmentationCompression() {
  let baseDir =
      path.join(rootDir, 'src/neuroglancer/sliceview/compressed_segmentation');
  fs.writeFileSync(
      path.join(baseDir, 'encode_common.ts'),
      env.render(path.join(baseDir, 'encode_common.template.ts')));
  for (let dataType of ['uint64', 'uint32']) {
    let context = {dataType, strideMultiplier: dataType === 'uint64' ? 2 : 1};
    for (let op of ['encode', 'decode']) {
      fs.writeFileSync(
          path.join(baseDir, `${op}_${dataType}.ts`),
          env.render(path.join(baseDir, `${op}.template.ts`), context));
    }
  }
}

function makeSubstitutions(inputPath, outputPath, replacements) {
  let inputContents = fs.readFileSync(inputPath, {encoding: 'utf-8'});
  for (let patternAndReplacement of replacements) {
    inputContents = inputContents.replace(patternAndReplacement[0], patternAndReplacement[1]);
  }
  fs.writeFileSync(outputPath, inputContents);
}

function writeDataStructures() {
  const baseDir = path.join(rootDir, 'src/neuroglancer/util');
  for (let arrayType
           of ['Uint8Array', 'Uint16Array', 'Float32Array', 'Uint32Array',
               'Float64Array', 'Int8Array', 'Int16Array', 'Int32Array']) {
    makeSubstitutions(
        path.join(baseDir, 'typedarray_builder.template.ts'),
        path.join(baseDir, `${arrayType.toLowerCase()}_builder.ts`),
        [[/\$TYPE\$/g, arrayType]]);
  }
  for (let i = 0; i < 2; ++i) {
    const nextPrevReplacements = [
      [/NEXT_PROPERTY/g, `next${i}`],
      [/PREV_PROPERTY/g, `prev${i}`],
    ];
    makeSubstitutions(
        path.join(baseDir, 'linked_list.template.ts'),
        path.join(baseDir, `linked_list.${i}.ts`),
        nextPrevReplacements);

    makeSubstitutions(
        path.join(baseDir, 'pairing_heap.template.ts'),
        path.join(baseDir, `pairing_heap.${i}.ts`),
        [[/CHILD_PROPERTY/g, `child${i}`], ...nextPrevReplacements]);
  }
}

writeSegmentationCompression();
writeDataStructures();
