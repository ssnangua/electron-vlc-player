import type { BrowserWindow } from 'electron';
import type { MediaInfo, MediaMetadata, MediaStreamInfo } from './native';
import type { VlcEvent } from './vlc-constants';
import type { VlcHardwareAcceleration } from './hardware-acceleration';

export interface VlcSetSourceOptions {
  /** 加载后是否自动播放（默认 true） */
  autoplay?: boolean;
  /** 传给 libvlc_media_add_option 的参数字符串，如 `:network-caching=3000` */
  mediaOptions?: string[];
}

export interface VlcPlayerOptions {
  /** Electron window that hosts the page */
  window: BrowserWindow;
  /** 本地路径或 http(s) URL；省略则 embed() 仅嵌入播放器，不加载媒体 */
  src?: string;
  /**
   * CSS selector for the page element to embed the player into.
   * Position and size follow the element via getBoundingClientRect().
   */
  container: string;
  /** libVLC 根目录（须包含 libvlc 主库与 plugins/） */
  vlcDir: string;
  /**
   * libVLC 解码硬件加速（进程级 `--avcodec-hw=`，默认 `none`）。
   * 修改须销毁全部播放器后重建，或使用 {@link VlcPlayer.setHardwareAcceleration}。
   */
  hardwareAcceleration?: VlcHardwareAcceleration;
  /** Show built-in overlay controls (default: true) */
  controls?: boolean;
  /** 控制条是否显示「页面全屏」按钮（默认 true）；窗口全屏时该按钮会自动隐藏 */
  pageFullscreenButton?: boolean;
  /**
   * 播放列表路径（供控制条「播放上一个媒体 / 播放下一个媒体」；至少 2 条才显示按钮）。
   * 也可用 {@link VlcPlayer.setPlaylist} 动态更新。
   */
  playlist?: string[];
  /** 当前条目播完后自动播放下一个媒体（默认 true，需 playlist 且存在下一项；`playbackMode` 为 `loop`/`repeat` 时片尾行为由模式决定） */
  autoAdvancePlaylist?: boolean;
  /**
   * 片尾播放模式（默认 `default`）：
   * - `default`：顺序播完停止（可配合 `autoAdvancePlaylist` 自动下一首）
   * - `loop`：列表循环（最后一首后回到第一首）
   * - `repeat`：单曲循环（重复当前条目）
   */
  playbackMode?: VlcPlaybackMode;
  /**
   * 进度条悬停预览雪碧图缓存根目录（全局，默认 `%TEMP%/evp-preview`）。
   * 目录结构：`{dir}/{mediaKey}/index.json` + `sprite.jpg`。
   * 也可用 {@link VlcPlayer.setSeekPreviewCacheDir} 设置。
   */
  seekPreviewCacheDir?: string;
  /**
   * ffmpeg 可执行文件路径（全局，用于离线生成悬停预览雪碧图）。
   * 也可用 {@link VlcPlayer.setFfmpegPath} 设置；可选用 {@link probeDefaultFfmpegPath} 探测后再传入。
   */
  ffmpegPath?: string;
  /**
   * 播放器 UI 语言（BCP 47，如 `zh-CN`、`en`、`ja`）。
   * 省略时按 Electron / 系统语言自动选择；无匹配语言包时回退英语。
   */
  locale?: string;
}

/** 片尾播放模式（对应 libVLC `libvlc_playback_mode_t` 语义） */
export type VlcPlaybackMode = 'default' | 'loop' | 'repeat';

/** `playlistItemChanged` 事件载荷 */
export interface VlcPlaylistItemChangedPayload {
  src: string;
  index: number;
}

/** overlay 上右键（`overlayContextMenu`）；可自行 `Menu.popup` */
export interface VlcOverlayContextMenuPayload {
  /** 相对 overlay 客户区的坐标 */
  x: number;
  y: number;
}

/** 控制条弹层中的轨条目 */
export interface VlcOverlayTrackItem {
  id: number;
  label: string;
}

/** `openSubtitle`：内置对话框已选文件但 libVLC 未能加载时 */
export interface VlcOpenSubtitlePayload {
  filePath: string;
  canceled: false;
}

export type VlcTrackKind = 'audio' | 'video' | 'subtitle';

/** 轨道切换事件载荷（`audioTrackChanged` / `videoTrackChanged` / `subtitleTrackChanged`） */
export interface VlcTrackChangedPayload {
  type: typeof VlcEvent.MediaPlayerESSelected;
  /** 当前选中的轨道 id；字幕关闭时为 `-1` */
  trackId: number;
}

/** libVLC 媒体播放器事件载荷（由 native 线程异步投递） */
export interface VlcPlayerEventPayload {
  /** libvlc_event_e 数值，见 VlcEvent */
  type: number;
  /** 当前时间（毫秒），timeChanged 等事件时可能有 */
  time?: number;
  /** 总时长（毫秒） */
  length?: number;
  /** 播放位置 0–1 */
  position?: number;
  /** `MediaPlayerESSelected`：libvlc_track_type_t，见 `VlcTrackType` */
  trackType?: number;
  /** `MediaPlayerESSelected`：当前轨道 id */
  trackId?: number;
}

/** 媒体查询结果：始终有数据字段；`notice` 非空表示结果可能不完整（非异常） */
export interface MediaQueryResult<T> {
  data: T;
  notice?: string;
}

export type MediaMetadataResult = MediaQueryResult<MediaMetadata>;
export type MediaTracksResult = MediaQueryResult<MediaStreamInfo[]>;

/** `parseMedia()` 完成后的媒体信息（元数据 + 轨列表 + 基础状态） */
export interface MediaParsedResult {
  info: MediaInfo;
  metadata: MediaMetadata;
  tracks: MediaStreamInfo[];
  /** 与 `getMediaTracksResult().notice` 相同；非空表示轨信息可能不完整 */
  tracksNotice?: string;
  /** 当前播放器报告的时长（毫秒），0 表示未知 */
  length: number;
}

/** `probeMedia()`：不加载进播放器，仅解析路径/URL 的时长与基础元数据 */
export interface MediaProbeResult {
  /** 是否 parse 成功 */
  parsed: boolean;
  /** 时长（毫秒），0 表示未知 */
  length: number;
  metadata: MediaMetadata;
}
