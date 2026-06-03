import type { BrowserWindow } from 'electron';
import type { VlcPlaybackMode } from '../types';

export const SEEK_END_MARGIN_MS = 50;
export const PLAYER_CONTAINER_STYLE_ID = 'evp-player-container-style';
export const PLAYER_FS_STYLE_ID = 'evp-player-fullscreen-style';

/** 与桌面 VLC「添加字幕文件」对话框一致的扩展名（另含 libVLC 常用的 sup） */
export const SUBTITLE_FILE_EXTENSIONS = [
  'cdg',
  'idx',
  'srt',
  'sub',
  'utf',
  'ass',
  'ssa',
  'aqt',
  'jss',
  'psb',
  'rt',
  'sami',
  'smi',
  'txt',
  'smil',
  'stl',
  'usf',
  'dks',
  'pjs',
  'mpl2',
  'mks',
  'vtt',
  'sup',
  'tt',
  'ttml',
  'dfxp',
  'scc',
] as const;

export function normalizePlaybackMode(value: string | undefined): VlcPlaybackMode {
  if (value === 'loop' || value === 'repeat') return value;
  return 'default';
}

export function getNativeHandle(window: BrowserWindow): Buffer {
  return window.getNativeWindowHandle();
}
