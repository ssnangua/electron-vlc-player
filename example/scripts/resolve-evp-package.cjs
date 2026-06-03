'use strict';

const fs = require('node:fs');
const path = require('node:path');

function resolveEvpPackageRoot() {
  return path.dirname(require.resolve('electron-vlc-player/package.json'));
}

function resolveEvpPaths() {
  const packageRoot = resolveEvpPackageRoot();
  return {
    packageRoot,
    distIndex: path.join(packageRoot, 'dist', 'index.js'),
    bindingPath: path.join(packageRoot, 'build', 'Release', 'vlc_binding.node'),
  };
}

/** True when `file:..` resolves to this repository root */
function isLocalRepoLink(exampleRoot) {
  const repoRoot = path.join(exampleRoot, '..');
  let packageRoot;
  try {
    packageRoot = resolveEvpPackageRoot();
  } catch {
    return false;
  }
  try {
    return fs.realpathSync(packageRoot) === fs.realpathSync(repoRoot);
  } catch {
    return false;
  }
}

module.exports = {
  resolveEvpPackageRoot,
  resolveEvpPaths,
  isLocalRepoLink,
};
