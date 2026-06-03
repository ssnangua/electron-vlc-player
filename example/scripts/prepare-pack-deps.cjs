'use strict';

/**
 * electron-builder cannot pack a file:.. link to the repo root (including build/ at repo root) into asar.
 * Before packaging locally, install a publishable copy via npm pack (respects npm "files").
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
    '[example] Local file:.. link detected; installing a publishable copy via npm pack before packaging…',
  );

  fs.rmSync(packDir, { recursive: true, force: true });
  fs.mkdirSync(packDir, { recursive: true });

  runNpm(['pack', '--pack-destination', packDir, '--silent'], repoRoot);

  const tgz = fs
    .readdirSync(packDir)
    .find((name) => name.endsWith('.tgz'));
  if (!tgz) {
    throw new Error(`npm pack did not produce a .tgz in ${packDir}`);
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
    '[example] Installed npm pack copy temporarily (electron-builder will rebuild native). Run npm run link after packaging to restore the local link.',
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
