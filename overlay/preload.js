const { contextBridge, ipcRenderer, webUtils } = require('electron');

let playerId = 0;

ipcRenderer.on('evp:register', (_e, id) => {
  playerId = id;
});

ipcRenderer.on('evp:focus-overlay', () => {
  const hit = document.getElementById('hit-area');
  if (hit) hit.focus({ preventScroll: true });
});

function collectDroppedPaths(dataTransfer) {
  const paths = [];
  for (const file of dataTransfer.files) {
    try {
      const filePath = webUtils.getPathForFile(file);
      if (filePath) paths.push(filePath);
    } catch {
      // ignore invalid File
    }
  }
  return paths;
}

function isFileDrag(dataTransfer) {
  if (!dataTransfer) return false;
  if (dataTransfer.files.length > 0) return true;
  return Array.from(dataTransfer.types).includes('Files');
}

function syncFileDragOver(event) {
  ipcRenderer.send('evp:file-drag-at', {
    screenX: event.screenX,
    screenY: event.screenY,
    fileDrag: event.dataTransfer ? isFileDrag(event.dataTransfer) : false,
  });
}

function installHostFileDrop() {
  const onDragEnter = (event) => {
    if (!event.dataTransfer || !isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    syncFileDragOver(event);
  };
  const onDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    syncFileDragOver(event);
  };
  const onDragLeave = (event) => {
    syncFileDragOver(event);
  };
  const onDrop = (event) => {
    event.preventDefault();
    ipcRenderer.send('evp:clear-file-drag-over');
    const paths = collectDroppedPaths(event.dataTransfer);
    if (paths.length) ipcRenderer.send('evp:host-drop-files', paths);
  };
  window.addEventListener('dragenter', onDragEnter, true);
  window.addEventListener('dragover', onDragOver, true);
  window.addEventListener('dragleave', onDragLeave, true);
  window.addEventListener('drop', onDrop, true);
}

installHostFileDrop();

contextBridge.exposeInMainWorld('evp', {
  togglePause: () => {
    ipcRenderer.send('evp:toggle-pause', playerId);
  },
  playPrevious: () => {
    ipcRenderer.send('evp:play-previous', playerId);
  },
  playNext: () => {
    ipcRenderer.send('evp:play-next', playerId);
  },
  togglePageFullscreen: () => {
    ipcRenderer.send('evp:toggle-page-fullscreen', playerId);
  },
  toggleFullScreen: () => {
    ipcRenderer.send('evp:toggle-fullscreen', playerId);
  },
  exitFullscreen: () => {
    ipcRenderer.send('evp:exit-fullscreen', playerId);
  },
  seek: (ms) => {
    ipcRenderer.send('evp:seek', playerId, ms);
  },
  seekPosition: (position) => {
    ipcRenderer.send('evp:seek-position', playerId, position);
  },
  beginSeekScrub: () => {
    ipcRenderer.send('evp:begin-seek-scrub', playerId);
  },
  seekMsScrub: (ms) => {
    ipcRenderer.send('evp:seek-ms-scrub', playerId, ms);
  },
  endSeekScrub: () => {
    ipcRenderer.send('evp:end-seek-scrub', playerId);
  },
  seekBy: (deltaMs) => {
    ipcRenderer.send('evp:seek-by', playerId, deltaMs);
  },
  setVolume: (v) => {
    ipcRenderer.send('evp:set-volume', playerId, v);
  },
  toggleMute: () => {
    ipcRenderer.send('evp:toggle-mute', playerId);
  },
  setRate: (rate) => {
    ipcRenderer.send('evp:set-rate', playerId, rate);
  },
  setAudioTrack: (trackId) => {
    ipcRenderer.send('evp:set-audio-track', playerId, trackId);
  },
  setSubtitleTrack: (trackId) => {
    ipcRenderer.send('evp:set-subtitle-track', playerId, trackId);
  },
  openSubtitle: () => {
    ipcRenderer.send('evp:open-subtitle', playerId);
  },
  generateSeekPreview: () => {
    ipcRenderer.send('evp:generate-seek-preview', playerId);
  },
  onState: (cb) => {
    ipcRenderer.on('evp:state', (_e, id, state) => {
      if (id === playerId) cb(state);
    });
  },
  onStrings: (cb) => {
    ipcRenderer.on('evp:strings', (_e, strings) => cb(strings));
  },
});
