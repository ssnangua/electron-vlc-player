'use strict';

/**
 * Run smoke-play.cjs in the Electron main process (not plain node).
 * Usage: npm run smoke-play
 *   or: npm run smoke-play -- "C:\path\to\video.mkv"
 *   or: node scripts/run-smoke-play.cjs [video-file]
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
