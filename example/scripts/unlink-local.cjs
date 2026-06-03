'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isLocalRepoLink } = require('./resolve-evp-package.cjs');

const exampleRoot = path.join(__dirname, '..');

function runNpm(args, extraEnv = {}) {
  const result = spawnSync('npm', args, {
    cwd: exampleRoot,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!isLocalRepoLink(exampleRoot)) {
  console.log('[example] Not linked to the local repo; using electron-vlc-player from npm.');
  process.exit(0);
}

const pkg = require(path.join(exampleRoot, 'package.json'));
const spec = pkg.dependencies?.['electron-vlc-player'];
if (!spec || spec.startsWith('file:')) {
  console.error('[example] package.json is missing a valid electron-vlc-player version range');
  process.exit(1);
}

console.log(`[example] Switching back to npm registry (${spec}, latest matching version)…`);
runNpm(['install', `electron-vlc-player@${spec}`]);
console.log('[example] Using npm package. postinstall rebuilt native for Electron; run npm run dev to start.');
