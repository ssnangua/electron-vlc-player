'use strict';

/**
 * Minimal playback test: no UI; verifies libVLC + native + Electron embed without crashing.
 * Must be started with Electron (not plain node):
 *   npm run smoke-play
 *   npm run smoke-play -- "C:\path\to\video.mp4"
 *   node scripts/run-smoke-play.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');

if (!electron?.app) {
  console.error(
    '[smoke] Run this script via Electron, for example:\n' +
      '  npm run smoke-play\n' +
      '  npm run smoke-play -- "<video-path>"\n' +
      '  node scripts/run-smoke-play.cjs "<video-path>"',
  );
  process.exit(1);
}

const { app, BrowserWindow } = electron;
const { VlcPlayer, probeDefaultVlcDir } = require('electron-vlc-player');

const exampleRoot = path.join(__dirname, '..');
const defaultVideo = path.join(exampleRoot, 'test', 'nice.mp4');
const smokePage = path.join(exampleRoot, 'test', 'smoke.html');
const videoPath = process.argv[2] || defaultVideo;

if (!fs.existsSync(videoPath)) {
  console.error(`[smoke] Video not found: ${videoPath}`);
  console.error('  Default: example/test/nice.mp4, or pass a path: npm run smoke-play -- "<video>"');
  process.exit(1);
}
if (!fs.existsSync(smokePage)) {
  console.error(`[smoke] Page not found: ${smokePage}`);
  process.exit(1);
}

app.commandLine.appendSwitch('disable-crash-reporter');

function resolveSmokeVlcDir() {
  const dir = probeDefaultVlcDir();
  if (dir) return dir;
  throw new Error('libVLC not found (probeDefaultVlcDir returned null)');
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 960,
    height: 540,
    useContentSize: true,
    show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  await win.loadFile(smokePage);

  const player = new VlcPlayer({
    window: win,
    container: '#stage',
    vlcDir: resolveSmokeVlcDir(),
    controls: false,
  });

  win.on('resize', () => {
    if (!player.isEmbedded()) return;
    player.notifyLayoutChange();
  });

  console.log('[smoke] embed...');
  await player.embed();
  console.log('[smoke] embedded', player.isEmbedded());
  player.notifyLayoutChange();
  await delay(300);

  console.log('[smoke] setSource:', videoPath);
  try {
    player.setSource(videoPath, { autoplay: false });
    console.log('[smoke] setSource ok');
    player.play();
    console.log('[smoke] play ok');
    player.notifyLayoutChange();
    await delay(300);
    player.notifyLayoutChange();
  } catch (e) {
    console.error('[smoke] setSource/play error', e);
  }

  await delay(8000);
  console.log('[smoke] done');
});

process.on('uncaughtException', (err) => {
  console.error('[smoke] uncaughtException', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[smoke] unhandledRejection', err);
});

app.on('window-all-closed', () => app.quit());
