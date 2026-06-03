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
  fail('electron-vlc-player is not installed. Run:\n  npm install');
}

const { distIndex, bindingPath } = paths;

if (!fs.existsSync(distIndex)) {
  fail(
    'electron-vlc-player is missing dist/. From the example directory run:\n  npm run rebuild',
  );
}

if (!fs.existsSync(bindingPath)) {
  if (forPack) {
    console.log(
      '[example] Skipping native pre-check; electron-builder will rebuild it.',
    );
    process.exit(0);
  }
  fail(
    `Native module not found:\n  ${bindingPath}\n` +
      'From the example directory run:\n  npm install\n  or\n  npm run rebuild',
  );
}
