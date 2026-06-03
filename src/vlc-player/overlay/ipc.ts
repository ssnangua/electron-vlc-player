import { ipcMain } from 'electron';
import type { IpcMainEvent } from 'electron';
import { getBinding } from '../../native';
import type { VlcPlayerHost } from '../host';

function overlayPlaybackAllowed(host: VlcPlayerHost): boolean {
  return !!host.source;
}

export interface OverlayIpcHandlers {
  onContainerLayoutChanged: () => void;
  onTogglePause: (event: IpcMainEvent) => void;
  onPlayPrevious: (event: IpcMainEvent) => void;
  onPlayNext: (event: IpcMainEvent) => void;
  onSeek: (event: IpcMainEvent, playerId: number, ms: number) => void;
  onSeekPosition: (event: IpcMainEvent, playerId: number, position: number) => void;
  onBeginSeekScrub: (event: IpcMainEvent) => void;
  onSeekPositionScrub: (event: IpcMainEvent, playerId: number, position: number) => void;
  onSeekMsScrub: (event: IpcMainEvent, playerId: number, ms: number) => void;
  onEndSeekScrub: (event: IpcMainEvent) => void;
  onSeekBy: (event: IpcMainEvent, playerId: number, deltaMs: number) => void;
  onSetVolume: (event: IpcMainEvent, playerId: number, volume: number) => void;
  onToggleMute: (event: IpcMainEvent) => void;
  onSetRate: (event: IpcMainEvent, playerId: number, rate: number) => void;
  onTogglePageFullscreen: (event: IpcMainEvent) => void;
  onToggleFullScreen: (event: IpcMainEvent) => void;
  onExitFullscreen: (event: IpcMainEvent) => void;
  onSetAudioTrack: (event: IpcMainEvent, playerId: number, trackId: number) => void;
  onSetSubtitleTrack: (event: IpcMainEvent, playerId: number, trackId: number) => void;
  onOpenSubtitle: (event: IpcMainEvent) => void;
  onGenerateSeekPreview: (event: IpcMainEvent) => void;
}

export function createOverlayIpcHandlers(host: VlcPlayerHost): OverlayIpcHandlers {
  return {
    onContainerLayoutChanged: () => {
      host.scheduleLayoutSync(true);
    },

    onTogglePause: (event) => {
      if (!host.overlayIpcAllowed(event) || !overlayPlaybackAllowed(host)) return;
      host.togglePause();
    },

    onPlayPrevious: (event) => {
      if (!host.overlayIpcAllowed(event) || !overlayPlaybackAllowed(host)) return;
      host.playPrevious();
    },

    onPlayNext: (event) => {
      if (!host.overlayIpcAllowed(event) || !overlayPlaybackAllowed(host)) return;
      host.playNext();
    },

    onSeek: (event, _playerId, ms) => {
      if (!host.overlayIpcAllowed(event) || !overlayPlaybackAllowed(host)) return;
      const b = getBinding();
      if (!b.isSeekable(host.playerId)) return;
      host.overlaySeek.seekOverlayToMs(Number(ms));
    },

    onSeekPosition: (event, _playerId, position) => {
      if (!host.overlayIpcAllowed(event) || !overlayPlaybackAllowed(host)) return;
      const b = getBinding();
      if (!b.isSeekable(host.playerId)) return;
      const pos = host.overlaySeek.normalizeSeekPosition(Number(position));
      if (pos == null) return;
      host.overlaySeek.performOverlaySeek(
        () => b.setPosition(host.playerId, pos),
        host.overlaySeek.targetMsFromPosition(pos),
      );
    },

    onBeginSeekScrub: (event) => {
      if (!host.overlayIpcAllowed(event) || !overlayPlaybackAllowed(host)) return;
      host.overlaySeek.beginOverlaySeekScrub();
    },

    onSeekPositionScrub: (event, _playerId, position) => {
      if (!host.overlayIpcAllowed(event) || !overlayPlaybackAllowed(host)) return;
      if (!host.overlaySeek.overlayScrubSession.active) return;
      host.overlaySeek.scrubOverlayToPosition(Number(position));
    },

    onSeekMsScrub: (event, _playerId, ms) => {
      if (!host.overlayIpcAllowed(event) || !overlayPlaybackAllowed(host)) return;
      if (!host.overlaySeek.overlayScrubSession.active) return;
      host.overlaySeek.scrubOverlayToMs(Number(ms));
    },

    onEndSeekScrub: (event) => {
      if (!host.overlayIpcAllowed(event) || !overlayPlaybackAllowed(host)) return;
      host.overlaySeek.endOverlaySeekScrub();
    },

    onGenerateSeekPreview: (event) => {
      if (!host.overlayIpcAllowed(event) || !overlayPlaybackAllowed(host)) return;
      host.generateSeekPreviewSprite();
    },

    onSeekBy: (event, _playerId, deltaMs) => {
      if (!host.overlayIpcAllowed(event) || !overlayPlaybackAllowed(host)) return;
      const delta = Number(deltaMs);
      if (!Number.isFinite(delta) || delta === 0) return;
      const b = getBinding();
      if (!b.isSeekable(host.playerId)) return;
      const next = host.clampSeekTimeMs(b.getTime(host.playerId) + delta);
      host.overlaySeek.seekOverlayToMs(next);
    },

    onSetVolume: (event, _playerId, volume) => {
      if (!host.overlayIpcAllowed(event)) return;
      host.overlayWindow.handleSetVolume(Number(volume));
    },

    onToggleMute: (event) => {
      if (!host.overlayIpcAllowed(event)) return;
      host.overlayWindow.handleToggleMute();
    },

    onSetRate: (event, _playerId, rate) => {
      if (!host.overlayIpcAllowed(event) || !overlayPlaybackAllowed(host)) return;
      if (Number.isFinite(rate) && rate > 0) {
        host.setRate(rate);
        host.pushState();
      }
    },

    onTogglePageFullscreen: (event) => {
      if (!host.overlayIpcAllowed(event)) return;
      void host.togglePageFullscreen();
      host.pushState();
    },

    onToggleFullScreen: (event) => {
      if (!host.overlayIpcAllowed(event)) return;
      void host.setFullScreen(!host.isFullScreen());
      host.pushState();
    },

    onExitFullscreen: (event) => {
      if (!host.overlayIpcAllowed(event)) return;
      host.handleEscapeFullscreen();
    },

    onSetAudioTrack: (event, _playerId, trackId) => {
      if (!host.overlayIpcAllowed(event)) return;
      if (Number.isFinite(trackId)) {
        host.setAudioTrack(trackId);
        host.pushState();
      }
    },

    onSetSubtitleTrack: (event, _playerId, trackId) => {
      if (!host.overlayIpcAllowed(event)) return;
      if (Number.isFinite(trackId)) {
        host.setSubtitleTrack(trackId);
        host.pushState();
      }
    },

    onOpenSubtitle: (event) => {
      if (!host.overlayIpcAllowed(event)) return;
      void host.pickAndAddSubtitleFile();
    },
  };
}

export function registerOverlayIpc(handlers: OverlayIpcHandlers): void {
  ipcMain.on('evp:container-layout-changed', handlers.onContainerLayoutChanged);
  ipcMain.on('evp:toggle-pause', handlers.onTogglePause);
  ipcMain.on('evp:play-previous', handlers.onPlayPrevious);
  ipcMain.on('evp:play-next', handlers.onPlayNext);
  ipcMain.on('evp:seek', handlers.onSeek);
  ipcMain.on('evp:seek-position', handlers.onSeekPosition);
  ipcMain.on('evp:begin-seek-scrub', handlers.onBeginSeekScrub);
  ipcMain.on('evp:seek-position-scrub', handlers.onSeekPositionScrub);
  ipcMain.on('evp:seek-ms-scrub', handlers.onSeekMsScrub);
  ipcMain.on('evp:end-seek-scrub', handlers.onEndSeekScrub);
  ipcMain.on('evp:seek-by', handlers.onSeekBy);
  ipcMain.on('evp:set-volume', handlers.onSetVolume);
  ipcMain.on('evp:toggle-mute', handlers.onToggleMute);
  ipcMain.on('evp:set-rate', handlers.onSetRate);
  ipcMain.on('evp:toggle-page-fullscreen', handlers.onTogglePageFullscreen);
  ipcMain.on('evp:toggle-fullscreen', handlers.onToggleFullScreen);
  ipcMain.on('evp:exit-fullscreen', handlers.onExitFullscreen);
  ipcMain.on('evp:set-audio-track', handlers.onSetAudioTrack);
  ipcMain.on('evp:set-subtitle-track', handlers.onSetSubtitleTrack);
  ipcMain.on('evp:open-subtitle', handlers.onOpenSubtitle);
  ipcMain.on('evp:generate-seek-preview', handlers.onGenerateSeekPreview);
}

export function unregisterOverlayIpc(handlers: OverlayIpcHandlers): void {
  ipcMain.removeListener('evp:container-layout-changed', handlers.onContainerLayoutChanged);
  ipcMain.removeListener('evp:toggle-pause', handlers.onTogglePause);
  ipcMain.removeListener('evp:play-previous', handlers.onPlayPrevious);
  ipcMain.removeListener('evp:play-next', handlers.onPlayNext);
  ipcMain.removeListener('evp:seek', handlers.onSeek);
  ipcMain.removeListener('evp:seek-position', handlers.onSeekPosition);
  ipcMain.removeListener('evp:begin-seek-scrub', handlers.onBeginSeekScrub);
  ipcMain.removeListener('evp:seek-position-scrub', handlers.onSeekPositionScrub);
  ipcMain.removeListener('evp:seek-ms-scrub', handlers.onSeekMsScrub);
  ipcMain.removeListener('evp:end-seek-scrub', handlers.onEndSeekScrub);
  ipcMain.removeListener('evp:seek-by', handlers.onSeekBy);
  ipcMain.removeListener('evp:set-volume', handlers.onSetVolume);
  ipcMain.removeListener('evp:toggle-mute', handlers.onToggleMute);
  ipcMain.removeListener('evp:set-rate', handlers.onSetRate);
  ipcMain.removeListener('evp:toggle-page-fullscreen', handlers.onTogglePageFullscreen);
  ipcMain.removeListener('evp:toggle-fullscreen', handlers.onToggleFullScreen);
  ipcMain.removeListener('evp:exit-fullscreen', handlers.onExitFullscreen);
  ipcMain.removeListener('evp:set-audio-track', handlers.onSetAudioTrack);
  ipcMain.removeListener('evp:set-subtitle-track', handlers.onSetSubtitleTrack);
  ipcMain.removeListener('evp:open-subtitle', handlers.onOpenSubtitle);
  ipcMain.removeListener('evp:generate-seek-preview', handlers.onGenerateSeekPreview);
}
