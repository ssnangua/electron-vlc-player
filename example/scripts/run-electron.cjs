'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const exampleRoot = path.join(__dirname, '..');

function resolveElectronPath() {
  try {
    return require('electron');
  } catch {
    throw new Error('Electron is not installed. Run: npm install');
  }
}

const electronPath = resolveElectronPath();
const entry = process.argv[2] || 'dist/main.js';

const result = spawnSync(electronPath, ['--disable-crash-reporter', entry], {
  cwd: exampleRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_DISABLE_CRASH_REPORTER: '1',
  },
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
