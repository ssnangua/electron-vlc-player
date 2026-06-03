'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const packageRoot = path.join(__dirname, '..');
const bindingDest = path.join(packageRoot, 'build', 'Release', 'vlc_binding.node');

function findAppRoot(start) {
  let dir = start;
  for (let i = 0; i < 16; i++) {
    const nested = path.join(dir, 'node_modules', 'electron-vlc-player', 'package.json');
    if (fs.existsSync(nested)) {
      return dir;
    }

    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = require(pkgPath);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (pkg.name === 'electron-vlc-player' && deps.electron) {
          return dir;
        }
        if (pkg.name !== 'electron-vlc-player' && deps['electron-vlc-player']) {
          return dir;
        }
      } catch {
        // ignore invalid package.json
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveElectronVersion(appRoot) {
  const candidates = [
    path.join(appRoot, 'node_modules', 'electron', 'package.json'),
    path.join(packageRoot, 'node_modules', 'electron', 'package.json'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      return require(file).version;
    }
  }
  try {
    return require('electron/package.json').version;
  } catch {
    return null;
  }
}

async function rebuildWithModule(appRoot, electronVersion) {
  const options = {
    buildPath: appRoot,
    electronVersion,
    arch: process.arch,
    force: true,
    onlyModules: ['electron-vlc-player'],
  };

  try {
    const mod = require('@electron/rebuild');
    const run = mod.rebuild ?? mod.default ?? mod;
    await run(options);
    return fs.existsSync(bindingDest);
  } catch {
    return false;
  }
}

function rebuildWithNpx(appRoot) {
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(
    npxCmd,
    ['--yes', '@electron/rebuild@3', '-f', '-w', 'electron-vlc-player'],
    { cwd: appRoot, stdio: 'inherit', env: process.env },
  );
  return result.status === 0 && fs.existsSync(bindingDest);
}

function resolveConsumerAppRoot() {
  const seeds = [packageRoot];
  if (process.env.INIT_CWD) seeds.unshift(process.env.INIT_CWD);
  if (process.env.npm_config_local_prefix) seeds.unshift(process.env.npm_config_local_prefix);

  for (const seed of seeds) {
    const root = findAppRoot(seed);
    if (root) return root;
  }
  return null;
}

function warnManualRebuild() {
  console.warn('  npx electron-rebuild -f -w electron-vlc-player');
}

async function main() {
  if (process.env.SKIP_EVP_NATIVE_REBUILD === '1') {
    return;
  }

  const appRoot = resolveConsumerAppRoot();
  const electronVersion = appRoot ? resolveElectronVersion(appRoot) : null;

  if (!appRoot) {
    console.warn(
      '[electron-vlc-player] Could not locate app root; skipping native rebuild.',
    );
    console.warn('  After installing electron, run:');
    warnManualRebuild();
    return;
  }

  if (!electronVersion) {
    console.warn('[electron-vlc-player] electron not found; skipping native rebuild.');
    console.warn('  Install electron first, then run:');
    warnManualRebuild();
    return;
  }

  console.log(
    `[electron-vlc-player] Rebuilding native module for Electron ${electronVersion}…`,
  );
  const ok =
    (await rebuildWithModule(appRoot, electronVersion)) || rebuildWithNpx(appRoot);
  if (!ok) {
    console.warn(
      '[electron-vlc-player] Electron rebuild failed. Install platform build tools, then run:',
    );
    warnManualRebuild();
  }
}

main().catch((err) => {
  console.warn('[electron-vlc-player] install script error:', err.message);
});
