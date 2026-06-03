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

function copyBinding(src) {
  fs.mkdirSync(path.dirname(bindingDest), { recursive: true });
  fs.copyFileSync(src, bindingDest);
  return true;
}

/** prebuildify 输出：prebuilds/<platform>-<arch>/vlc_binding.node */
function tryLocalPrebuild() {
  const triple = `${process.platform}-${process.arch}`;
  const candidates = [
    path.join(packageRoot, 'prebuilds', triple, 'vlc_binding.node'),
    path.join(packageRoot, 'prebuilds', triple, 'node.napi.node'),
  ];
  for (const src of candidates) {
    if (fs.existsSync(src)) {
      copyBinding(src);
      console.log(`[electron-vlc-player] 已使用本地 prebuild (${triple})`);
      return true;
    }
  }
  return false;
}

/** 从 GitHub Release 下载（发布 npm 包且带 release 资源时） */
function tryPrebuildInstallDownload() {
  let bin;
  try {
    bin = require.resolve('prebuild-install/bin.js', { paths: [packageRoot, __dirname] });
  } catch {
    return false;
  }

  const result = spawnSync(process.execPath, [bin], {
    cwd: packageRoot,
    env: {
      ...process.env,
      npm_config_runtime: 'napi',
      npm_config_build_from_source: 'false',
    },
    stdio: 'pipe',
    encoding: 'utf8',
  });

  if (result.status === 0 && fs.existsSync(bindingDest)) {
    console.log('[electron-vlc-player] 已通过 prebuild-install 安装 napi 二进制');
    return true;
  }
  return false;
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

async function main() {
  if (process.env.SKIP_EVP_NATIVE_REBUILD === '1') {
    return;
  }

  const appRoot = resolveConsumerAppRoot();
  const electronVersion = appRoot ? resolveElectronVersion(appRoot) : null;

  // 消费者已安装 Electron 时，必须为 Electron ABI 编译，不能先用 Node prebuild
  if (appRoot && electronVersion) {
    console.log(
      `[electron-vlc-player] 正在为 Electron ${electronVersion} 编译 native 模块…`,
    );
    const ok =
      (await rebuildWithModule(appRoot, electronVersion)) || rebuildWithNpx(appRoot);
    if (ok) return;
    console.warn('[electron-vlc-player] Electron 编译失败，尝试 Node prebuild 回退…');
  }

  if (tryLocalPrebuild() || tryPrebuildInstallDownload()) {
    return;
  }

  if (!appRoot) {
    console.warn(
      '[electron-vlc-player] 无可用 prebuild，且无法定位应用根目录。请执行 npm run rebuild 或安装 electron 后 electron-rebuild。',
    );
    return;
  }

  if (!electronVersion) {
    console.warn(
      '[electron-vlc-player] 无 prebuild 且未检测到 electron。请先安装 electron，或从源码编译：',
    );
    console.warn('  npm run rebuild');
    console.warn('  npx electron-rebuild -f -w electron-vlc-player');
  }
}

main().catch((err) => {
  console.warn('[electron-vlc-player] install 脚本异常:', err.message);
});
