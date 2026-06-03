'use strict';

/**
 * electron-builder 无法把 file:.. 链到的仓库根目录（含 repo 根下 build/）打进 asar。
 * 本地开发打包前用 npm pack 安装一份符合 npm "files" 字段的库副本。
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isLocalRepoLink } = require('./resolve-evp-package.cjs');

const exampleRoot = path.join(__dirname, '..');
const repoRoot = path.join(exampleRoot, '..');
const packDir = path.join(exampleRoot, '.pack-tmp');

function runNpm(args, cwd, extraEnv = {}) {
  const result = spawnSync('npm', args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed (exit ${result.status})`);
  }
}

function preparePackDeps() {
  if (!isLocalRepoLink(exampleRoot)) {
    return;
  }

  console.log(
    '[example] 检测到本地 file:.. 链接；打包前用 npm pack 安装可发布的库副本…',
  );

  fs.rmSync(packDir, { recursive: true, force: true });
  fs.mkdirSync(packDir, { recursive: true });

  runNpm(['pack', '--pack-destination', packDir, '--silent'], repoRoot);

  const tgz = fs
    .readdirSync(packDir)
    .find((name) => name.endsWith('.tgz'));
  if (!tgz) {
    throw new Error(`npm pack 未在 ${packDir} 生成 .tgz`);
  }

  runNpm(
    [
      'install',
      path.join(packDir, tgz),
      '--no-save',
      '--no-fund',
      '--no-audit',
    ],
    exampleRoot,
    { SKIP_EVP_NATIVE_REBUILD: '1' },
  );

  console.log(
    '[example] 已临时安装 npm pack 副本（electron-builder 会重编 native）。打包后可 npm run link 恢复本地链接。',
  );
}

if (require.main === module) {
  try {
    preparePackDeps();
  } catch (err) {
    console.error('[example] prepare-pack-deps failed:', err.message);
    process.exit(1);
  }
}

module.exports = { preparePackDeps };
