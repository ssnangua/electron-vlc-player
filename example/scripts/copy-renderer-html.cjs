'use strict';

const fs = require('node:fs');
const path = require('node:path');

function copyDirRecursive(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, name.name);
    const dest = path.join(destDir, name.name);
    if (name.isDirectory()) {
      copyDirRecursive(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

const rendererSrc = path.join(__dirname, '..', 'src', 'renderer');
const rendererDest = path.join(__dirname, '..', 'dist', 'renderer');

fs.mkdirSync(rendererDest, { recursive: true });
fs.copyFileSync(
  path.join(rendererSrc, 'index.html'),
  path.join(rendererDest, 'index.html'),
);

const assetsSrc = path.join(rendererSrc, 'assets');
if (fs.existsSync(assetsSrc)) {
  copyDirRecursive(assetsSrc, path.join(rendererDest, 'assets'));
}
