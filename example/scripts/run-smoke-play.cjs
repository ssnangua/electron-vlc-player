'use strict';

/**
 * 用 Electron 主进程运行 smoke-play.cjs（不能用裸 node）。
 * 用法: npm run smoke-play
 *   或: npm run smoke-play -- "C:\path\to\video.mkv"
 *   或: node scripts/run-smoke-play.cjs [video-file]
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const exampleRoot = path.join(__dirname, '..');
const videoPath = process.argv[2];

let electronPath;
try {
  electronPath = require('electron');
} catch {
  console.error('Electron is not installed. Run: npm install');
  process.exit(1);
}

const script = path.join(__dirname, 'smoke-play.cjs');
const electronArgs = videoPath ? [script, videoPath] : [script];
const result = spawnSync(electronPath, electronArgs, {
  cwd: exampleRoot,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
