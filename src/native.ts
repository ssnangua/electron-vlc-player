import path from 'node:path';

import {
  normalizeHardwareAcceleration,
  type VlcHardwareAcceleration,
} from './hardware-acceleration';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const binding = require(path.join(__dirname, '..', 'build', 'Release', 'vlc_binding.node')) as VlcBinding;

export interface TrackInfo {
  id: number;
  name: string;
}

export interface LibVlcVersionInfo {
  version: string;
  compiler: string;
  changeset: string;
}

export interface MediaInfo {
  duration: number;
  state: number;
  parsed: boolean;
}

/** libVLC 元数据（`getMediaMetadata`；需先 `parseMedia()`） */
export interface MediaMetadata {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  date?: string;
  description?: string;
  copyright?: string;
  language?: string;
  publisher?: string;
  encodedBy?: string;
  trackNumber?: string;
  url?: string;
  nowPlaying?: string;
  artworkUrl?: string;
  rating?: string;
  showName?: string;
  actors?: string;
  director?: string;
  albumArtist?: string;
}

/** 媒体内各条流（`getMediaTracks`；编解码器 / 语言 / 分辨率等） */
export interface MediaStreamInfo {
  id: number;
  type: 'video' | 'audio' | 'subtitle' | 'unknown';
  codec?: string;
  language?: string;
  description?: string;
  bitrate?: number;
  width?: number;
  height?: number;
  /** 视频轨标称帧率（parse 后由轨信息提供，VLC 4+） */
  frameRate?: number;
  channels?: number;
  sampleRate?: number;
}

export interface VideoSize {
  width: number;
  height: number;
}

/** 底层 libVLC 绑定（与 native 模块导出一致） */
export interface VlcBinding {
  init(vlcDir: string, hardwareAcceleration?: string): boolean;
  getHardwareAcceleration(): string;
  getLibVlcVersion(): LibVlcVersionInfo;

  createPlayer(parentHwnd: Buffer, x: number, y: number, width: number, height: number): number;
  setMedia(id: number, src: string, autoplay?: boolean): boolean;
  setMediaEx(id: number, src: string, autoplay?: boolean, options?: string[]): boolean;
  destroyPlayer(id: number): void;

  setBounds(id: number, x: number, y: number, width: number, height: number): void;
  setBoundsFromScreen(id: number, x: number, y: number, width: number, height: number): void;
  reparentPlayer(id: number, parentHwnd: Buffer): void;
  raisePlayer(id: number): void;
  setPlayerWindowVisible(id: number, visible: boolean): void;
  setPlayerStackBelow(id: number, below: boolean): void;
  setPlayerOffscreenEmbed(id: number, offscreen: boolean): void;

  play(id: number): void;
  pause(id: number): void;
  togglePause(id: number): void;
  stop(id: number): void;
  isPlaying(id: number): boolean;

  getState(id: number): number;
  willPlay(id: number): boolean;
  canPause(id: number): boolean;
  isPaused(id: number): boolean;
  setPause(id: number, paused: boolean): void;
  isSeekable(id: number): boolean;
  hasVout(id: number): boolean;

  getTime(id: number): number;
  setTime(id: number, ms: number): void;
  getLength(id: number): number;
  getPosition(id: number): number;
  setPosition(id: number, position: number): void;
  getRate(id: number): number;
  setRate(id: number, rate: number): void;
  getFps(id: number): number;

  getVolume(id: number): number;
  setVolume(id: number, volume: number): void;
  toggleMute(id: number): void;
  /** libvlc_audio_get_mute 原值：1=静音、0=非静音、-1=未知（与 libVLC 文档一致） */
  getMuteRaw(id: number): number;
  getMute(id: number): boolean;
  setMute(id: number, mute: boolean): void;
  getAudioChannel(id: number): number;
  setAudioChannel(id: number, channel: number): void;
  getAudioDelay(id: number): number;
  setAudioDelay(id: number, delayUs: number): void;
  getAudioTracks(id: number): TrackInfo[];
  getAudioTrack(id: number): number;
  setAudioTrack(id: number, trackId: number): void;

  getSubtitleTracks(id: number): TrackInfo[];
  getSubtitleTrack(id: number): number;
  setSubtitleTrack(id: number, trackId: number): void;
  /** 加载外挂字幕（uri 须含 file:// 等 scheme；LibVLC 3+） */
  addSubtitleFile(id: number, uri: string): boolean;
  getVideoTracks(id: number): TrackInfo[];
  getVideoTrack(id: number): number;
  setVideoTrack(id: number, trackId: number): void;
  getScale(id: number): number;
  setScale(id: number, scale: number): void;
  getAspectRatio(id: number): string;
  setAspectRatio(id: number, ratio: string): void;
  setCropGeometry(id: number, geometry: string): void;
  getVideoSize(id: number): VideoSize;
  getDeinterlace(id: number): string;
  setDeinterlace(id: number, mode: string): void;
  takeSnapshot(id: number, filepath: string, num?: number, width?: number, height?: number): boolean;

  getChapter(id: number): number;
  setChapter(id: number, chapter: number): void;
  getChapterCount(id: number): number;
  getChapterDescriptions(id: number, titleIndex?: number): TrackInfo[];
  getTitleIndex(id: number): number;
  setTitleIndex(id: number, title: number): void;
  getTitleCount(id: number): number;
  getTitleDescriptions(id: number, titleIndex?: number): TrackInfo[];
  nextChapter(id: number): void;
  previousChapter(id: number): void;
  navigate(id: number, mode: number): void;

  getVlcFullscreen(id: number): boolean;
  setVlcFullscreen(id: number, fullscreen: boolean): void;
  getRole(id: number): number;
  setRole(id: number, role: number): void;
  getMediaInfo(id: number): MediaInfo;
  parseMedia(id: number, timeoutMs?: number): boolean;
  /** 不绑定播放器：解析 src 的时长与元数据（需已 initLibVlc） */
  probeMedia(src: string, timeoutMs?: number): import('./types').MediaProbeResult;
  getMediaMetadata(id: number, parse?: boolean, timeoutMs?: number): MediaMetadata;
  getMediaTracks(id: number, parse?: boolean, timeoutMs?: number): MediaStreamInfo[];

  /** 设置/清除 libVLC 事件回调（由 LibVLC 在首次 on() 时注册） */
  setPlayerEventHandler(
    id: number,
    callback: ((payload: import('./types').VlcPlayerEventPayload) => void) | null,
  ): void;
}

let initialized = false;
let initializedVlcDir: string | null = null;
let currentHardwareAcceleration: VlcHardwareAcceleration = 'none';

export type { VlcHardwareAcceleration } from './hardware-acceleration';
export {
  normalizeHardwareAcceleration,
  VLC_HARDWARE_ACCELERATION_MODES,
} from './hardware-acceleration';

/**
 * 加载或切换 libVLC 目录与进程级 `--avcodec-hw` 配置。
 * 切换路径或硬件加速模式前须销毁全部播放器实例（`VlcPlayer.destroy()`）。
 */
export function initLibVlc(
  vlcDir: string,
  options?: { hardwareAcceleration?: VlcHardwareAcceleration },
): void {
  const hw =
    options?.hardwareAcceleration !== undefined
      ? normalizeHardwareAcceleration(String(options.hardwareAcceleration))
      : currentHardwareAcceleration;
  binding.init(vlcDir, hw);
  initialized = true;
  initializedVlcDir = vlcDir;
  currentHardwareAcceleration = hw;
}

/** 当前 libVLC 进程的 `--avcodec-hw` 取值（未 init 时返回待生效的默认值 `none`） */
export function getHardwareAcceleration(): VlcHardwareAcceleration {
  if (initialized) {
    return binding.getHardwareAcceleration() as VlcHardwareAcceleration;
  }
  return currentHardwareAcceleration;
}

/**
 * 切换硬件加速模式（对应 libVLC `--avcodec-hw=`）。
 * 须先销毁全部 `VlcPlayer` 实例；有播放器存活时会抛错。
 */
export function setHardwareAcceleration(mode: VlcHardwareAcceleration): void {
  const hw = normalizeHardwareAcceleration(String(mode));
  if (initialized && hw === getHardwareAcceleration()) {
    return;
  }
  if (!initializedVlcDir) {
    currentHardwareAcceleration = hw;
    return;
  }
  binding.init(initializedVlcDir, hw);
  currentHardwareAcceleration = hw;
}

export function getBinding(): VlcBinding {
  if (!initialized) {
    throw new Error('libvlc not initialized');
  }
  return binding;
}

/**
 * 解析媒体路径/URL 的时长与基础元数据，无需加载进播放器（与桌面 VLC 播放列表预读类似）。
 * 须已 init libVLC（例如 `VlcPlayer` 已 embed）。
 */
export function probeMedia(src: string, timeoutMs = 5000): import('./types').MediaProbeResult {
  const trimmed = src.trim();
  if (!trimmed) {
    throw new Error('probeMedia requires a non-empty path or URL');
  }
  return getBinding().probeMedia(trimmed, timeoutMs);
}
