import type { BrowserWindow, IpcMainEvent, Rectangle } from 'electron';
import { getBinding, getHardwareAcceleration, initLibVlc, setHardwareAcceleration } from '../native';
import type { VlcHardwareAcceleration } from '../hardware-acceleration';
import { LibVLC } from '../libvlc';
import { registerSeekPreviewScheme, updateSeekPreviewProtocolCacheRoot } from '../preview-protocol';
import { resolveFfmpegExecutable } from '../seek-preview-sprite';
import type {
  VlcPlayerOptions,
  VlcSetSourceOptions,
  VlcPlaybackMode,
} from '../types';
import { getPlayerStrings, resolvePlayerLocale } from '../i18n';
import { resolveVlcDir } from '../vlc-path';
import { SEEK_END_MARGIN_MS, normalizePlaybackMode } from './constants';
import { GraceController } from './grace';
import { LayoutController } from './layout';
import {
  createOverlayIpcHandlers,
  registerOverlayIpc,
  unregisterOverlayIpc,
  type OverlayIpcHandlers,
} from './overlay/ipc';
import { OverlaySeekController } from './overlay/seek';
import { OverlayWindowController } from './overlay/window';
import { PlaylistController } from './playlist';
import { SeekPreviewController } from './seek-preview-config';
import type { VlcPlayerHost } from './host';
import type { OverlayTrackCache } from './types';

registerSeekPreviewScheme();

/**
 * Electron 内嵌 libVLC 播放器：布局/全屏/控制栏 + 完整 libVLC 播放 API（`play`、`setSource`、`on('playing')` 等）。
 */
export class VlcPlayer extends LibVLC implements VlcPlayerHost {
  readonly window: BrowserWindow;
  source: string | null;
  containerSelector: string;
  readonly showControls: boolean;
  readonly showPageFullscreenButton: boolean;
  readonly autoAdvancePlaylist: boolean;
  locale: string;
  strings: ReturnType<typeof getPlayerStrings>;
  playerId = -1;
  destroyed = false;
  embedPromise: Promise<void> | null = null;
  embedLayoutSynced = false;
  containerResizeObserverInstalled = false;
  mediaLabelParseForSource: string | null = null;
  mediaToken = 0;
  replayInProgress = false;
  lastPaintRaiseAt = 0;

  readonly grace: GraceController;
  readonly seekPreview: SeekPreviewController;
  readonly playlist: PlaylistController;
  readonly layout: LayoutController;
  readonly overlayWindow: OverlayWindowController;
  readonly overlaySeek: OverlaySeekController;

  private readonly ipcHandlers: OverlayIpcHandlers;

  private readonly onWebContentsPaint = () => {
    if (this.playerId < 0 || this.destroyed) return;
    if (!this.source) return;
    const now = Date.now();
    if (now - this.lastPaintRaiseAt < 120) return;
    this.lastPaintRaiseAt = now;
    if (this.overlayWindow.overlay?.isVisible() && this.overlayWindow.shouldShowOverlay()) return;
    this.raiseNativeLayer();
  };

  constructor(options: VlcPlayerOptions) {
    super(() => this.playerId);

    if (!options.container?.trim()) {
      throw new Error('VlcPlayer requires `container` (CSS selector)');
    }
    if (!options.vlcDir?.trim()) {
      throw new Error('VlcPlayer requires `vlcDir` (libVLC root directory)');
    }

    this.window = options.window;
    this.containerSelector = options.container;
    const initialSrc = options.src?.trim();
    this.source = initialSrc ? initialSrc : null;
    this.showControls = options.controls !== false;
    this.showPageFullscreenButton = options.pageFullscreenButton !== false;
    this.autoAdvancePlaylist = options.autoAdvancePlaylist !== false;
    this.locale = resolvePlayerLocale(options.locale);
    this.strings = getPlayerStrings(this.locale);

    this.grace = new GraceController(this);
    this.seekPreview = new SeekPreviewController(this);
    this.playlist = new PlaylistController(this);
    this.layout = new LayoutController(this);
    this.overlayWindow = new OverlayWindowController(this);
    this.overlaySeek = new OverlaySeekController(this);
    this.playlist.playbackMode = normalizePlaybackMode(options.playbackMode);

    const vlcDir = resolveVlcDir(options.vlcDir);
    initLibVlc(vlcDir, {
      hardwareAcceleration: options.hardwareAcceleration,
    });

    if (options.playlist?.length) {
      this.playlist.setPlaylist(options.playlist);
    }
    if (options.seekPreviewCacheDir?.trim()) {
      SeekPreviewController.setSeekPreviewCacheDir(options.seekPreviewCacheDir);
    } else {
      updateSeekPreviewProtocolCacheRoot(SeekPreviewController.getSeekPreviewCacheDir());
    }

    if (options.ffmpegPath?.trim()) {
      const ffmpeg = resolveFfmpegExecutable(options.ffmpegPath);
      if (!ffmpeg) {
        throw new Error(
          `Invalid ffmpegPath: ${options.ffmpegPath} (not an existing executable file)`,
        );
      }
      SeekPreviewController.setFfmpegPath(ffmpeg);
    }

    this.ipcHandlers = createOverlayIpcHandlers(this);
    registerOverlayIpc(this.ipcHandlers);
    this.attachWindowListeners();
  }

  // --- Static seek preview / ffmpeg / hardware acceleration ---

  static getSeekPreviewCacheDir = SeekPreviewController.getSeekPreviewCacheDir;
  static setSeekPreviewCacheDir = SeekPreviewController.setSeekPreviewCacheDir;
  static clearSeekPreviewCacheDir = SeekPreviewController.clearSeekPreviewCacheDir;
  static setFfmpegPath = SeekPreviewController.setFfmpegPath;
  static getFfmpegPath = SeekPreviewController.getFfmpegPath;
  static getHardwareAcceleration = getHardwareAcceleration;
  static setHardwareAcceleration = setHardwareAcceleration;

  getSeekPreviewCacheDir(): string {
    return this.seekPreview.getSeekPreviewCacheDir();
  }

  setSeekPreviewCacheDir(dir: string): void {
    this.seekPreview.setSeekPreviewCacheDir(dir);
  }

  clearSeekPreviewCacheDir(): void {
    this.seekPreview.clearSeekPreviewCacheDir();
  }

  getHardwareAcceleration(): VlcHardwareAcceleration {
    return getHardwareAcceleration();
  }

  setHardwareAcceleration(mode: VlcHardwareAcceleration): void {
    setHardwareAcceleration(mode);
  }

  setFfmpegPath(ffmpegPath: string): void {
    this.seekPreview.setFfmpegPath(ffmpegPath);
  }

  getFfmpegPath(): string {
    return this.seekPreview.getFfmpegPath();
  }

  /**
   * 停止播放并卸载当前媒体（不销毁播放器）。
   * 清空播放列表等场景须用此方法，避免 `stop()` + `pushState()` 在过渡期查询 native API 导致崩溃。
   */
  unloadMedia(): void {
    if (this.destroyed || !this.isEmbedded()) return;

    this.markSourceChangeGrace();
    this.grace.suppressEndReached(3000);
    this.replayInProgress = false;
    this.cancelSeekPreviewSprite();
    this.cancelOverlaySeekSession();
    this.mediaLabelParseForSource = null;
    this.source = null;
    this.playlist.syncPlaylistIndexToSource();
    this.mediaToken += 1;
    this.resetOverlayStateCache();

    try {
      super.stop();
    } catch {
      // ignore
    }

    this.pushOverlayCachedState(false);
    this.overlayWindow.updateOverlayPresence();
  }

  generateSeekPreviewSprite(): void {
    this.seekPreview.generateSeekPreviewSprite();
  }

  cancelSeekPreviewSprite(): void {
    this.seekPreview.cancelSeekPreviewSprite();
  }

  hideOverlay(): void {
    this.overlayWindow.hideOverlay();
  }

  showOverlay(): void {
    this.overlayWindow.showOverlay();
  }

  focusOverlay(options?: { stealWindowFocus?: boolean }): void {
    this.overlayWindow.focusOverlay(options);
  }

  openOverlayDevTools(): void {
    this.overlayWindow.openOverlayDevTools();
  }

  // --- Playlist ---

  hasPlaylistControls(): boolean {
    return this.playlist.hasPlaylistControls();
  }

  getPlaylist(): readonly string[] {
    return this.playlist.getPlaylist();
  }

  getPlaylistIndex(): number {
    return this.playlist.getPlaylistIndex();
  }

  hasPrevious(): boolean {
    return this.playlist.hasPrevious();
  }

  hasNext(): boolean {
    return this.playlist.hasNext();
  }

  setPlaylist(paths: string[]): void {
    this.playlist.setPlaylist(paths);
  }

  playPrevious(): boolean {
    return this.playlist.playPrevious();
  }

  playNext(): boolean {
    return this.playlist.playNext();
  }

  getPlaybackMode(): VlcPlaybackMode {
    return this.playlist.getPlaybackMode();
  }

  setPlaybackMode(mode: VlcPlaybackMode): void {
    this.playlist.setPlaybackMode(mode);
  }

  /** 当前 UI 语言包 id（BCP 47，如 `zh-CN`、`en`） */
  getLocale(): string {
    return this.locale;
  }

  /**
   * 运行时切换控制条 UI 语言。overlay 已创建时会立即刷新文案与轨菜单。
   * @returns 解析后的内置语言包 id
   */
  setLocale(locale: string): string {
    if (this.destroyed) return this.locale;
    const resolved = resolvePlayerLocale(locale);
    if (resolved === this.locale) return resolved;
    this.locale = resolved;
    this.strings = getPlayerStrings(resolved);
    if (this.overlayWindow.overlay && !this.overlayWindow.overlay.isDestroyed()) {
      this.overlayWindow.sendOverlayStrings();
      this.pushState();
    }
    return resolved;
  }

  // --- Embed / lifecycle ---

  embed(): Promise<void> {
    if (this.destroyed) throw new Error('VlcPlayer already destroyed');
    if (this.playerId >= 0) return Promise.resolve();
    if (!this.embedPromise) {
      this.embedPromise = this.layout.ensurePlayerReady();
    }
    return this.embedPromise;
  }

  isEmbedded(): boolean {
    return this.playerId >= 0;
  }

  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'endReached' && Date.now() < this.grace.suppressEndReachedUntil) {
      if (this.grace.sourceChangeInProgress || !this.isMediaNaturallyComplete()) {
        return false;
      }
    }
    return super.emit(event, ...args);
  }

  clampSeekTimeMs(ms: number): number {
    if (!Number.isFinite(ms)) return 0;
    let target = Math.max(0, Math.floor(ms));
    if (this.playerId < 0) return target;
    try {
      const len = getBinding().getLength(this.playerId);
      if (len > 0) {
        const maxSeek = Math.max(0, len - SEEK_END_MARGIN_MS);
        if (target > maxSeek) target = maxSeek;
      }
    } catch {
      // ignore
    }
    return target;
  }

  override setTime(ms: number): void {
    this.markSeekGrace();
    super.setTime(this.clampSeekTimeMs(ms));
  }

  override setPosition(position: number): void {
    this.markSeekGrace();
    let p = position;
    if (Number.isFinite(p)) {
      if (p >= 1) p = 0.999;
      else if (p < 0) p = 0;
    }
    super.setPosition(p);
  }

  isMediaNaturallyComplete(): boolean {
    return this.playlist.isMediaNaturallyComplete();
  }

  shouldReplayFromStart(): boolean {
    return this.playlist.shouldReplayFromStart();
  }

  replayFromStart(): void {
    this.playlist.replayFromStart();
  }

  override play(): void {
    if (!this.source) return;
    super.play();
  }

  override togglePause(): void {
    if (!this.source) return;
    if (this.shouldReplayFromStart()) {
      this.replayFromStart();
      return;
    }
    if (!this.isPlaying()) {
      this.play();
      return;
    }
    super.togglePause();
  }

  /** 嵌入时直接加载媒体，跳过 setSource 换源副作用 */
  setSourceDirect(src: string, options?: VlcSetSourceOptions): void {
    super.setSource(src, options);
  }

  override setSource(src: string, options?: VlcSetSourceOptions): void {
    if (this.destroyed) throw new Error('VlcPlayer already destroyed');
    const trimmed = src?.trim();
    if (!trimmed) {
      throw new Error('setSource requires a non-empty path or URL');
    }
    this.source = trimmed;
    if (this.mediaLabelParseForSource !== trimmed) {
      this.mediaLabelParseForSource = null;
    }
    this.cancelSeekPreviewSprite();
    this.cancelOverlaySeekSession();
    this.mediaToken += 1;
    this.resetOverlayStateCache();
    this.playlist.syncPlaylistIndexToSource();
    if (this.isEmbedded()) {
      this.markSourceChangeGrace();
      this.ensureOverlay();
      super.setSource(trimmed, options);
      this.scheduleLayoutSync(true);
      this.scheduleMediaLabelParse();
      this.pushOverlayCachedState(false);
      setImmediate(() => {
        if (!this.destroyed) this.pushState();
      });
    }
  }

  setContainer(container: string): void {
    this.layout.setContainer(container);
  }

  notifyLayoutChange(): void {
    if (this.destroyed) return;
    this.scheduleLayoutSync(true);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.embedPromise = null;

    this.layout.clearLayoutSyncTimer();
    this.overlaySeek.clearSeekTimers();
    this.grace.clearSourceChangeGraceTimer();
    this.cancelOverlaySeekSession();
    this.detachOverlayStateEvents();
    this.detachWindowListeners();
    this.cancelSeekPreviewSprite();

    if (this.playerId >= 0) {
      this.removeAllListeners();
      try {
        getBinding().stop(this.playerId);
      } catch {
        // 窗口关闭时 native 可能已部分失效
      }
      getBinding().destroyPlayer(this.playerId);
      this.playerId = -1;
    }

    if (this.layout.fullScreen && !this.window.isDestroyed()) {
      this.window.setFullScreen(false);
      this.layout.fullScreen = false;
    }
    if (this.layout.pageFullscreen || this.layout.fullScreen) {
      void this.layout.syncContainerExpandedDom(false);
      this.layout.pageFullscreen = false;
    }

    this.overlayWindow.destroyOverlay();
    unregisterOverlayIpc(this.ipcHandlers);
  }

  // --- Layout / fullscreen ---

  isPageFullscreen(): boolean {
    return this.layout.isPageFullscreen();
  }

  isFullScreen(): boolean {
    return this.layout.isFullScreen();
  }

  setPageFullscreen(on: boolean): Promise<void> {
    return this.layout.setPageFullscreen(on);
  }

  setFullScreen(on: boolean): Promise<void> {
    return this.layout.setFullScreen(on);
  }

  togglePageFullscreen(): void {
    this.layout.togglePageFullscreen();
  }

  handleEscapeFullscreen(): void {
    this.layout.handleEscapeFullscreen();
  }

  scheduleLayoutSync(immediate = false): void {
    this.layout.scheduleLayoutSync(immediate);
  }

  raiseNativeLayer(): void {
    this.layout.raiseNativeLayer();
  }

  syncLayout(): void {
    this.layout.syncLayout();
  }

  createPlayerInstance(): void {
    this.layout.createPlayerInstance();
  }

  boundsNearlyEqual(a: Rectangle | null, b: Rectangle): boolean {
    if (!a) return false;
    return (
      Math.abs(a.x - b.x) < 1 &&
      Math.abs(a.y - b.y) < 1 &&
      Math.abs(a.width - b.width) < 1 &&
      Math.abs(a.height - b.height) < 1
    );
  }

  // --- Overlay ---

  overlayIpcAllowed(event: IpcMainEvent): boolean {
    return this.overlayWindow.overlayIpcAllowed(event);
  }

  ensureOverlay(): void {
    this.overlayWindow.ensureOverlay();
  }

  attachOverlayStateEvents(): void {
    this.overlayWindow.attachOverlayStateEvents();
  }

  detachOverlayStateEvents(): void {
    this.overlayWindow.detachOverlayStateEvents();
  }

  pushState(): void {
    this.overlayWindow.pushState();
  }

  pushStateProgress(): void {
    this.overlayWindow.pushStateProgress();
  }

  pushOverlayCachedState(playing: boolean): void {
    this.overlayWindow.pushOverlayCachedState(playing);
  }

  scheduleMediaLabelParse(): void {
    this.overlayWindow.scheduleMediaLabelParse();
  }

  resetOverlayStateCache(): void {
    this.overlayWindow.resetOverlayStateCache();
  }

  getMediaDisplayLabel(): string {
    return this.overlayWindow.getMediaDisplayLabel();
  }

  getOverlayTrackState(): OverlayTrackCache {
    return this.overlayWindow.getOverlayTrackState();
  }

  pickAndAddSubtitleFile(): Promise<void> {
    return this.overlayWindow.pickAndAddSubtitleFile();
  }

  normalizeVolumeLevel(volume: number): number {
    return this.overlayWindow.normalizeVolumeLevel(volume);
  }

  syncOverlayMutedFromPlayer(): void {
    this.overlayWindow.syncOverlayMutedFromPlayer();
  }

  // --- Grace / seek ---

  markSeekGrace(): void {
    this.grace.markSeekGrace();
  }

  markSourceChangeGrace(): void {
    this.grace.markSourceChangeGrace();
  }

  cancelOverlaySeekSession(): void {
    this.overlaySeek.cancelOverlaySeekSession();
  }

  handlePlaybackEnd(): void {
    this.playlist.handlePlaybackEnd();
  }

  syncPlaybackEndListeners(): void {
    this.playlist.syncPlaybackEndListeners();
  }

  syncPlaylistIndexToSource(): void {
    this.playlist.syncPlaylistIndexToSource();
  }

  unregisterIpc(): void {
    unregisterOverlayIpc(this.ipcHandlers);
  }

  detachWindowListeners(): void {
    if (this.window.isDestroyed()) return;
    try {
      this.window.webContents.removeListener('paint', this.onWebContentsPaint);
    } catch {
      // webContents may already be gone
    }
  }

  private attachWindowListeners(): void {
    this.window.webContents.on('paint', this.onWebContentsPaint);

    this.window.on('enter-full-screen', () => {
      void this.layout.onWindowEnteredFullScreen();
    });
    this.window.on('leave-full-screen', () => {
      void this.layout.onWindowLeftFullScreen();
    });

    this.window.on('close', () => {
      if (!this.destroyed) this.destroy();
    });

    this.window.on('minimize', () => this.overlayWindow.updateOverlayPresence());
    this.window.on('restore', () => this.overlayWindow.updateOverlayPresence());
    this.window.on('hide', () => this.overlayWindow.updateOverlayPresence());
    this.window.on('focus', () => {
      this.overlayWindow.updateOverlayPresence();
      this.overlayWindow.onMainWindowFocusForMac();
    });
    this.window.on('blur', () => this.overlayWindow.onMainWindowBlurForMac());
    this.window.on('show', () => this.overlayWindow.updateOverlayPresence());
    this.window.on('move', () => this.layout.onMainWindowMoved());

    this.window.webContents.on('devtools-opened', () => {
      void this.layout.installContainerResizeObserver();
    });
    this.window.webContents.on('did-finish-load', () => {
      void this.layout.syncContainerBaseDom();
      void this.layout.installContainerResizeObserver();
      this.scheduleLayoutSync(true);
    });
  }
}
