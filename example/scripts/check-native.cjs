'use strict';

const fs = require('node:fs');

function fail(message) {
  console.error(`[example] ${message}`);
  process.exit(1);
}

const forPack = process.argv.includes('--for-pack');

let paths;
try {
  paths = require('./resolve-evp-package.cjs').resolveEvpPaths();
} catch {
  fail('未安装 electron-vlc-player。请执行：\n  npm install');
}

const { distIndex, bindingPath } = paths;

if (!fs.existsSync(distIndex)) {
  fail(
    'electron-vlc-player 缺少 dist/。请在 example 目录执行：\n  npm run rebuild',
  );
}

if (!fs.existsSync(bindingPath)) {
  if (forPack) {
    console.log(
      '[example] native 模块将由 electron-builder 重编，跳过预检。',
    );
    process.exit(0);
  }
  fail(
    `native 模块不存在：\n  ${bindingPath}\n` +
      '请在 example 目录执行：\n  npm install\n  或\n  npm run rebuild',
  );
}
