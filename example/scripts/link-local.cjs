'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isLocalRepoLink } = require('./resolve-evp-package.cjs');

const exampleRoot = path.join(__dirname, '..');
const repoRoot = path.join(exampleRoot, '..');

function runNpm(args, cwd, extraEnv = {}) {
  const result = spawnSync('npm', args, {
    cwd,
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

function ensureLocalPackageLink() {
  if (isLocalRepoLink(exampleRoot)) {
    console.log('[example] 已链接本仓库 electron-vlc-player (file:..)。');
    return;
  }
  console.log('[example] 链接 electron-vlc-player@file:.. (--no-save)…');
  runNpm(
    ['install', 'electron-vlc-player@file:..', '--no-save'],
    exampleRoot,
    { SKIP_EVP_NATIVE_REBUILD: '1' },
  );
}

function ensureRepoDependencies() {
  const markers = [
    path.join(repoRoot, 'node_modules', 'typescript'),
    path.join(repoRoot, 'node_modules', 'node-addon-api'),
  ];
  if (markers.every((p) => fs.existsSync(p))) {
    return;
  }
  console.log('[example] 安装 electron-vlc-player 根目录依赖…');
  runNpm(['install'], repoRoot, { SKIP_EVP_NATIVE_REBUILD: '1' });
}

ensureLocalPackageLink();
ensureRepoDependencies();
console.log('[example] 链接完成。请执行：npm run rebuild && npm start');
