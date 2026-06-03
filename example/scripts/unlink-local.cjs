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
  console.log('[example] 当前未链接本仓库，已使用 npm 上的 electron-vlc-player。');
  process.exit(0);
}

const pkg = require(path.join(exampleRoot, 'package.json'));
const spec = pkg.dependencies?.['electron-vlc-player'];
if (!spec || spec.startsWith('file:')) {
  console.error('[example] package.json 中缺少有效的 electron-vlc-player 版本范围');
  process.exit(1);
}

console.log(`[example] 改回 npm 注册表（${spec}，安装满足该范围的最新版）…`);
runNpm(['install', `electron-vlc-player@${spec}`]);
console.log('[example] 已切换为 npm 包。postinstall 已为 Electron 重编 native；可直接 npm start。');
