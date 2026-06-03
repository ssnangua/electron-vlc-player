'use strict';

/**
 * 本地开发一键重编 electron-vlc-player：
 * 1. 根目录 tsc → dist/
 * 2. 按当前 Electron 版本 node-gyp → vlc_binding.node
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveEvpPaths } = require('./resolve-evp-package.cjs');

const exampleRoot = path.join(__dirname, '..');

function resolveFromExample(specifier) {
  const searchPaths = [
    path.join(exampleRoot, 'node_modules'),
    path.join(exampleRoot, '..', 'node_modules'),
  ];
  return require.resolve(specifier, { paths: searchPaths });
}

function requireFromExample(specifier) {
  return require(resolveFromExample(specifier));
}

function runNpmScript(cwd, script) {
  const result = spawnSync('npm', ['run', script], {
    cwd,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm run ${script} failed in ${cwd} (exit ${result.status})`);
  }
}

function removeDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function buildLibraryTypeScript(packageRoot) {
  console.log('[example] ① TypeScript → dist/ …');
  runNpmScript(packageRoot, 'build');
}

function rebuildNativeElectron(packageRoot, electronVersion) {
  const nodeGypRoot = path.dirname(resolveFromExample('@electron/node-gyp/package.json'));
  const nodeGypBin = path.join(nodeGypRoot, 'bin', 'node-gyp.js');

  const env = {
    ...process.env,
    npm_config_runtime: 'electron',
    npm_config_target: electronVersion,
    npm_config_disturl: 'https://electronjs.org/headers',
    npm_config_arch: process.arch,
    npm_config_build_from_source: 'true',
  };

  console.log(
    `[example] ② native (Electron ${electronVersion}, ${process.arch}) …`,
  );

  const result = spawnSync(process.execPath, [nodeGypBin, 'rebuild'], {
    cwd: packageRoot,
    env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error('node-gyp rebuild for Electron failed (non-zero exit code)');
  }
}

async function rebuildModule() {
  if (process.env.SKIP_EVP_NATIVE_REBUILD === '1') {
    console.log('[example] SKIP_EVP_NATIVE_REBUILD=1，跳过 rebuild');
    return;
  }

  const { bindingPath, packageRoot, distIndex } = resolveEvpPaths();
  const electronVersion = requireFromExample('electron/package.json').version;

  buildLibraryTypeScript(packageRoot);

  removeDir(path.join(packageRoot, 'build'));
  removeDir(path.join(packageRoot, 'prebuilds'));
  rebuildNativeElectron(packageRoot, electronVersion);

  if (!fs.existsSync(distIndex)) {
    throw new Error(`dist 缺失：\n  ${distIndex}`);
  }
  if (!fs.existsSync(bindingPath)) {
    throw new Error(
      `native 缺失：\n  ${bindingPath}\n` +
        '请确认已安装 Visual Studio Build Tools（Windows）。',
    );
  }

  const metaPath = path.join(packageRoot, 'build', 'Release', '.forge-meta');
  if (fs.existsSync(metaPath)) {
    console.log('[example] ABI:', fs.readFileSync(metaPath, 'utf8').trim());
  }

  console.log('[example] rebuild 完成');
  console.log('  dist:', distIndex);
  console.log('  native:', bindingPath);
}

module.exports = { rebuildModule };

if (require.main === module) {
  rebuildModule().catch((err) => {
    console.error('[example] rebuild failed:', err.message);
    process.exit(1);
  });
}
