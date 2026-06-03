import type { BrowserWindow } from 'electron';
import type { VlcPlaybackMode } from '../types';

export const SEEK_END_MARGIN_MS = 50;
export const PLAYER_CONTAINER_STYLE_ID = 'evp-player-container-style';
export const PLAYER_FS_STYLE_ID = 'evp-player-fullscreen-style';

export function normalizePlaybackMode(value: string | undefined): VlcPlaybackMode {
  if (value === 'loop' || value === 'repeat') return value;
  return 'default';
}

export function getNativeHandle(window: BrowserWindow): Buffer {
  return window.getNativeWindowHandle();
}
