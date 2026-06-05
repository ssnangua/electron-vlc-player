#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const napiInclude = require('node-addon-api').include.replace(/^"|"$/g, '');
const nodeInclude =
  process.env.NVM_INC || path.join(path.dirname(process.execPath), '..', 'include', 'node');
const nativeInclude = path.join(root, 'src', 'native');
const vscodeDir = path.join(root, '.vscode');

const clangd = `CompileFlags:
  Add:
    - -std=c++17
    - -ObjC++
    - -DNAPI_DISABLE_CPP_EXCEPTIONS
    - -DNAPI_VERSION=10
    - -DBUILDING_NODE_EXTENSION
    - -I${napiInclude}
    - -I${nodeInclude}
    - -I${nativeInclude}
`;

const cppProperties = {
  configurations: [
    {
      name: 'node-native',
      includePath: [
        '${workspaceFolder}/node_modules/node-addon-api',
        '${workspaceFolder}/src/native',
        nodeInclude,
      ],
      defines: ['NAPI_DISABLE_CPP_EXCEPTIONS', 'NAPI_VERSION=10', 'BUILDING_NODE_EXTENSION'],
      compilerPath: '/usr/bin/clang++',
      cStandard: 'c17',
      cppStandard: 'c++17',
      intelliSenseMode: process.platform === 'darwin' ? 'macos-clang-arm64' : 'windows-clang-x64',
    },
  ],
  version: 4,
};

fs.writeFileSync(path.join(root, '.clangd'), clangd);
fs.mkdirSync(vscodeDir, { recursive: true });
fs.writeFileSync(
  path.join(vscodeDir, 'c_cpp_properties.json'),
  `${JSON.stringify(cppProperties, null, 2)}\n`,
);
console.log('Wrote .clangd and .vscode/c_cpp_properties.json');
