import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { EvpBridge, EvpLayoutBridge, MediaInfoView, PlaylistItem, StoredPlaylist } from './shared/evp-api';

function pathsFromDataTransfer(dataTransfer: DataTransfer): string[] {
  const paths: string[] = [];
  for (const file of Array.from(dataTransfer.files)) {
    try {
      const filePath = webUtils.getPathForFile(file);
      if (filePath) paths.push(filePath);
    } catch {
      // ignore invalid File
    }
  }
  return paths;
}

function isFileDrag(dataTransfer: DataTransfer): boolean {
  if (dataTransfer.files.length > 0) return true;
  return Array.from(dataTransfer.types).includes('Files');
}

function syncFileDragOver(event: DragEvent): void {
  ipcRenderer.send('evp:file-drag-at', {
    screenX: event.screenX,
    screenY: event.screenY,
    fileDrag: event.dataTransfer ? isFileDrag(event.dataTransfer) : false,
  });
}

function installHostFileDrop(): void {
  window.addEventListener(
    'dragenter',
    (event) => {
      if (!event.dataTransfer || !isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      document.body.classList.add('file-drag-over');
    },
    true,
  );

  window.addEventListener(
    'dragleave',
    (event) => {
      syncFileDragOver(event);
    },
    true,
  );

  window.addEventListener(
    'dragover',
    (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      syncFileDragOver(event);
    },
    true,
  );

  window.addEventListener(
    'drop',
    (event) => {
      event.preventDefault();
      document.body.classList.remove('file-drag-over');
      if (!event.dataTransfer) return;
      const paths = pathsFromDataTransfer(event.dataTransfer);
      if (!paths.length) return;
      void ipcRenderer.invoke('evp:add-media-paths', paths);
    },
    true,
  );
}

installHostFileDrop();

/** 供 VlcPlayer 注入的 ResizeObserver 回调：容器尺寸变化（含 DevTools 分割条） */
contextBridge.exposeInMainWorld('evpLayout', {
  notify: () => ipcRenderer.send('evp:container-layout-changed'),
} satisfies EvpLayoutBridge);

contextBridge.exposeInMainWorld('evp', {
  getState: () => ipcRenderer.invoke('evp:get-state'),
  pickVlcDir: () => ipcRenderer.invoke('evp:pick-vlc-dir'),
  pickFfmpegPath: () => ipcRenderer.invoke('evp:pick-ffmpeg-path'),
  pickOpenVideo: () => ipcRenderer.invoke('evp:pick-open-video'),
  pickAddVideos: () => ipcRenderer.invoke('evp:pick-add-videos'),
  playPath: (filePath: string) => ipcRenderer.invoke('evp:play-path', filePath),
  setVlcDir: (dir: string) => ipcRenderer.invoke('evp:set-vlc-dir', dir),
  setFfmpegPath: (path: string) => ipcRenderer.invoke('evp:set-ffmpeg-path', path),
  clearPlaylist: () => ipcRenderer.invoke('evp:clear-playlist'),
  removePlaylistItem: (filePath: string) =>
    ipcRenderer.invoke('evp:remove-playlist-item', filePath),
  showPlaylistItemMenu: (filePath: string, x: number, y: number) =>
    ipcRenderer.invoke('evp:playlist-item-menu', filePath, x, y),
  setPlaybackMode: (mode: 'default' | 'loop' | 'repeat') =>
    ipcRenderer.invoke('evp:set-playback-mode', mode),
  restorePlaylist: (data: StoredPlaylist) => ipcRenderer.invoke('evp:restore-playlist', data),
  addMediaPaths: (filePaths: string[]) => ipcRenderer.invoke('evp:add-media-paths', filePaths),
  onPlaylist: (callback: (data: { playlist: PlaylistItem[]; currentPath: string | null }) => void) => {
    ipcRenderer.on('evp:playlist', (_event, data) => callback(data));
  },
  onMediaInfo: (callback: (info: MediaInfoView) => void) => {
    ipcRenderer.on('evp:media-info', (_event, info) => callback(info));
  },
} satisfies EvpBridge);
