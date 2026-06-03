import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, dialog, screen } from 'electron';
import type {
  ContextMenuParams,
  IpcMainEvent,
  OpenDialogReturnValue,
  Rectangle,
} from 'electron';
import { getBinding } from '../../native';
import { formatMediaDisplayLabel } from '../../media-label';
import { resolveOverlayDir } from '../../overlay-path';
import { registerSeekPreviewProtocol } from '../../preview-protocol';
import type { VlcOverlayContextMenuPayload } from '../../types';
import { VlcState } from '../../vlc-constants';
import { SEEK_END_MARGIN_MS, SUBTITLE_FILE_EXTENSIONS } from '../constants';
import type { VlcPlayerHost } from '../host';
import type { OverlayPlaybackCache, OverlayTrackCache } from '../types';
import { OverlayTracksMenuController } from './tracks-menu';

export class OverlayWindowController {
  overlay: BrowserWindow | null = null;
  overlayEventsAttached = false;
  lastOverlayBounds: Rectangle | null = null;
  overlayManualHideDepth = 0;
  muteToggleGraceUntil = 0;
  pendingUnmuteFromVolume = false;
  pendingUnmuteFromVolumeUntil = 0;
  overlayPlaybackCache: OverlayPlaybackCache = {
    lengthMs: 0,
    timeMs: 0,
    volume: 100,
    muted: false,
    rate: 1,
    fps: 0,
  };
  overlayTrackCache: OverlayTrackCache = {
    audioTracks: [],
    subtitleTracks: [],
    audioTrackId: -1,
    subtitleTrackId: -1,
  };

  readonly tracksMenu: OverlayTracksMenuController;

  constructor(private readonly host: VlcPlayerHost) {
    this.tracksMenu = new OverlayTracksMenuController(host);
  }

  overlayIpcAllowed(event: IpcMainEvent): boolean {
    return (
      this.host.playerId >= 0 &&
      !!this.overlay &&
      !this.overlay.isDestroyed() &&
      event.sender === this.overlay.webContents &&
      this.overlayManualHideDepth === 0
    );
  }

  /** 打开控制栏 overlay 的开发者工具（调试悬停预览等） */
  openOverlayDevTools(): void {
    if (!this.overlay || this.overlay.isDestroyed()) return;
    this.overlay.webContents.openDevTools({ mode: 'detach' });
  }

  /** 暂时隐藏控制栏 overlay 子窗（如打开系统文件对话框前调用）。 */
  hideOverlay(): void {
    if (this.host.destroyed) return;
    const first = this.overlayManualHideDepth === 0;
    this.overlayManualHideDepth++;
    if (!first) return;
    if (this.overlay && !this.overlay.isDestroyed() && this.overlay.isVisible()) {
      this.overlay.hide();
    }
    if (!this.host.window.isDestroyed()) this.host.window.focus();
  }

  /** 恢复由 `hideOverlay()` 隐藏的控制栏（深度归零时）。 */
  showOverlay(): void {
    if (this.host.destroyed || this.overlayManualHideDepth <= 0) return;
    this.overlayManualHideDepth--;
    if (this.overlayManualHideDepth === 0) {
      this.updateOverlayPresence();
    }
  }

  /** 将键盘焦点交还给 overlay（`#hit-area`），便于快捷键与滚轮调音量。 */
  focusOverlay(): void {
    if (this.host.destroyed || !this.host.showControls || this.host.playerId < 0) return;
    if (this.overlayManualHideDepth > 0) return;

    this.host.ensureOverlay();
    this.updateOverlayPresence();
    if (!this.overlay || this.overlay.isDestroyed()) return;

    const focusHitArea = (): void => {
      if (!this.overlay || this.overlay.isDestroyed()) return;
      this.overlay.webContents.send('evp:focus-overlay');
    };

    this.syncOverlayBounds();
    if (!this.overlay.isVisible()) {
      this.overlay.show();
    }
    this.overlay.focus();
    if (this.overlay.webContents.isLoading()) {
      this.overlay.webContents.once('did-finish-load', focusHitArea);
    } else {
      focusHitArea();
    }
  }

  /** libVLC 音量接口为整数；以 set 后 get 的读数为准 */
  normalizeVolumeLevel(volume: number): number {
    if (!Number.isFinite(volume)) return 0;
    return Math.max(0, Math.min(100, Math.round(volume)));
  }

  /** libvlc_audio_get_mute：文档约定 1=静音，0=非静音，-1=未知 */
  syncOverlayMutedFromPlayer(): void {
    if (this.host.playerId < 0) return;
    if (this.pendingUnmuteFromVolume && Date.now() > this.pendingUnmuteFromVolumeUntil) {
      this.pendingUnmuteFromVolume = false;
    }
    try {
      const raw = getBinding().getMuteRaw(this.host.playerId);
      if (raw >= 0) {
        if (this.pendingUnmuteFromVolume) {
          if (raw > 0) return;
          this.pendingUnmuteFromVolume = false;
          this.overlayPlaybackCache.muted = false;
          return;
        }
        this.overlayPlaybackCache.muted = raw > 0;
        return;
      }
      if (this.pendingUnmuteFromVolume) return;
      this.overlayPlaybackCache.muted = this.host.getMute();
    } catch {
      // 保留 cache
    }
  }

  /** 显示 overlay 子窗（不抢主窗焦点）；控制条显隐由 overlay 内 CSS 负责 */
  ensureOverlayShown(): void {
    if (this.overlayManualHideDepth > 0) return;
    if (!this.overlay || this.overlay.isDestroyed() || !this.shouldShowOverlay()) return;
    if (!this.overlay.isVisible()) {
      this.syncOverlayBounds();
      this.overlay.showInactive();
      this.sendOverlayRegister();
    }
  }

  /** 有媒体后再创建控制层，避免空闲时多开一个 WebContents 拖慢主页面 */
  ensureOverlay(): void {
    if (!this.host.showControls || this.overlay || this.host.playerId < 0) return;
    this.createOverlay();
    this.host.attachOverlayStateEvents();
  }

  createOverlay(): void {
    registerSeekPreviewProtocol();
    const overlayDir = resolveOverlayDir();
    const screenBounds = this.host.layout.resolveOverlayScreenBounds();

    this.overlay = new BrowserWindow({
      parent: this.host.window,
      modal: false,
      x: screenBounds.x,
      y: screenBounds.y,
      width: screenBounds.width,
      height: screenBounds.height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      focusable: true,
      webPreferences: {
        preload: path.join(overlayDir, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.overlay.loadFile(path.join(overlayDir, 'controls.html'));
    this.overlay.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown' || input.key !== 'Escape') return;
      this.host.handleEscapeFullscreen();
    });
    this.overlay.webContents.on('context-menu', (event, params: ContextMenuParams) => {
      event.preventDefault();
      const payload: VlcOverlayContextMenuPayload = { x: params.x, y: params.y };
      this.host.emit('overlayContextMenu', payload);
    });
    this.overlay.webContents.once('did-finish-load', () => {
      this.sendOverlayRegister();
      this.updateOverlayPresence();
      this.host.pushState();
    });
    this.overlay.once('ready-to-show', () => {
      this.updateOverlayPresence();
    });
  }

  sendOverlayRegister(): void {
    if (!this.overlay || this.overlay.isDestroyed() || this.host.playerId < 0) return;
    this.overlay.webContents.send('evp:register', this.host.playerId);
    this.sendOverlayStrings();
  }

  sendOverlayStrings(): void {
    if (!this.overlay || this.overlay.isDestroyed()) return;
    this.overlay.webContents.send('evp:strings', {
      locale: this.host.locale,
      ...this.host.strings,
    });
  }

  shouldShowOverlay(): boolean {
    return (
      !this.host.destroyed &&
      this.host.playerId >= 0 &&
      this.host.showControls &&
      !!this.host.source &&
      this.host.window.isVisible() &&
      !this.host.window.isMinimized()
    );
  }

  updateOverlayPresence(): void {
    if (!this.overlay || this.overlay.isDestroyed()) return;

    if (!this.shouldShowOverlay() || this.overlayManualHideDepth > 0) {
      this.overlay.hide();
      return;
    }

    this.ensureOverlayShown();
  }

  /** 拖动/移动主窗口时同步 overlay（不依赖 ResizeObserver / paint） */
  onMainWindowMoved(): void {
    if (this.host.destroyed || !this.overlay || this.overlay.isDestroyed()) return;
    this.lastOverlayBounds = null;
    this.syncOverlayBounds();
  }

  syncOverlayBounds(): void {
    if (!this.overlay || this.overlay.isDestroyed()) return;
    const next = this.host.layout.resolveOverlayScreenBounds();
    if (this.host.boundsNearlyEqual(this.lastOverlayBounds, next)) return;
    this.lastOverlayBounds = { ...next };
    this.overlay.setBounds(next);
  }

  syncLayoutOverlay(): void {
    if (this.overlay && !this.overlay.isDestroyed()) {
      if (this.host.window.isVisible() && !this.host.window.isMinimized()) {
        this.syncOverlayBounds();
        if (!this.overlay.isVisible()) {
          this.updateOverlayPresence();
        }
      }
    }
  }

  destroyOverlay(): void {
    if (this.overlay && !this.overlay.isDestroyed()) {
      this.overlay.close();
    }
    this.overlay = null;
    this.lastOverlayBounds = null;
  }

  /** 订阅 libVLC 事件驱动 overlay 刷新（替代定时轮询） */
  attachOverlayStateEvents(): void {
    if (this.overlayEventsAttached || !this.host.showControls || this.host.playerId < 0) return;
    this.overlayEventsAttached = true;
    this.host.on('timeChanged', this.onOverlayVlcTimeChanged);
    this.host.on('positionChanged', this.onOverlayVlcPositionChanged);
    this.host.on('lengthChanged', this.onOverlayVlcLengthChanged);
    this.host.on('playing', this.onOverlayVlcPlaying);
    this.host.on('paused', this.onOverlayVlcPausedOrStopped);
    this.host.on('stopped', this.onOverlayVlcPausedOrStopped);
    this.host.on('audioTrackChanged', this.onOverlayVlcTrackChanged);
    this.host.on('subtitleTrackChanged', this.onOverlayVlcTrackChanged);
    this.host.on('endReached', this.onPlaybackEndedPushState);
  }

  detachOverlayStateEvents(): void {
    if (!this.overlayEventsAttached) return;
    this.overlayEventsAttached = false;
    this.host.off('timeChanged', this.onOverlayVlcTimeChanged);
    this.host.off('positionChanged', this.onOverlayVlcPositionChanged);
    this.host.off('lengthChanged', this.onOverlayVlcLengthChanged);
    this.host.off('playing', this.onOverlayVlcPlaying);
    this.host.off('paused', this.onOverlayVlcPausedOrStopped);
    this.host.off('stopped', this.onOverlayVlcPausedOrStopped);
    this.host.off('audioTrackChanged', this.onOverlayVlcTrackChanged);
    this.host.off('subtitleTrackChanged', this.onOverlayVlcTrackChanged);
    this.host.off('endReached', this.onPlaybackEndedPushState);
  }

  /** endReached 后立即用缓存刷新 overlay，避免在 Ended 下继续查轨表等 */
  private readonly onPlaybackEndedPushState = (): void => {
    if (this.host.destroyed || this.host.playerId < 0) return;
    this.host.pushState();
  };

  private readonly onOverlayVlcTimeChanged = (): void => {
    if (this.host.destroyed || this.host.playerId < 0) return;
    this.pushOverlayProgressFromEvent();
  };

  private readonly onOverlayVlcPositionChanged = (): void => {
    if (this.host.destroyed || this.host.playerId < 0) return;
    this.pushOverlayProgressFromEvent();
  };

  private readonly onOverlayVlcLengthChanged = (): void => {
    if (this.host.destroyed || this.host.playerId < 0) return;
    this.host.pushState();
  };

  private readonly onOverlayVlcPlaying = (): void => {
    if (this.host.destroyed || this.host.playerId < 0) return;
    if (this.host.replayInProgress) return;
    this.host.pushState();
  };

  private readonly onOverlayVlcPausedOrStopped = (): void => {
    if (this.host.destroyed || this.host.playerId < 0) return;
    if (this.host.replayInProgress) return;
    this.host.pushState();
  };

  private readonly onOverlayVlcTrackChanged = (): void => {
    if (this.host.destroyed || this.host.playerId < 0) return;
    this.host.pushState();
  };

  /** libVLC time/position 事件 → 从 native 读进度并刷新 overlay（不信任事件内 time 字段） */
  pushOverlayProgressFromEvent(): void {
    if (this.host.replayInProgress) return;
    if (Date.now() < this.host.grace.suppressOverlayProgressUntil) return;
    if (this.host.overlaySeek.overlaySeekSyncBlocked) return;
    if (this.host.overlaySeek.overlaySeekSyncTimer) return;
    this.pushStateProgress();
  }

  /** 从 libVLC 读取进度轻量字段（不查轨表、fps、mute/rate） */
  refreshOverlayPlaybackCacheFromNative(): void {
    if (this.host.playerId < 0) return;
    const b = getBinding();
    const seek = this.host.overlaySeek;
    try {
      const len = b.getLength(this.host.playerId);
      if (len > 0) this.overlayPlaybackCache.lengthMs = len;
    } catch {
      // ignore
    }
    try {
      const t = b.getTime(this.host.playerId);
      const now = Date.now();
      if (seek.overlaySeekTargetMs != null && now < seek.overlaySeekSettlingUntil) {
        this.overlayPlaybackCache.timeMs = seek.overlaySeekTargetMs;
      } else if (t >= 0) {
        this.overlayPlaybackCache.timeMs = t;
        if (now >= seek.overlaySeekSettlingUntil) {
          seek.overlaySeekTargetMs = null;
        }
      }
    } catch {
      // ignore
    }
    try {
      this.overlayPlaybackCache.volume = this.normalizeVolumeLevel(
        b.getVolume(this.host.playerId),
      );
    } catch {
      // ignore
    }
  }

  /**
   * 仅同步进度/播放态（不刷新轨表、fps），供 time/position 事件与 seek 使用。
   */
  pushStateProgress(): void {
    if (!this.overlay || this.overlay.isDestroyed() || this.host.playerId < 0) return;
    if (this.host.replayInProgress) return;

    const cache = this.overlayPlaybackCache;
    try {
      if (this.host.getState() === VlcState.Ended) {
        const lengthMs = cache.lengthMs > 0 ? cache.lengthMs : 0;
        this.sendOverlayState(
          this.buildOverlayUiState(false, lengthMs, lengthMs, true, this.overlayTrackCache, cache),
        );
        this.host.handlePlaybackEnd();
        return;
      }
    } catch {
      // ignore
    }

    this.refreshOverlayPlaybackCacheFromNative();

    let playing = false;
    try {
      playing = getBinding().isPlaying(this.host.playerId);
    } catch {
      // ignore
    }

    if (!playing) {
      this.host.handlePlaybackEnd();
    }

    this.sendOverlayState(
      this.buildOverlayUiState(
        playing,
        cache.timeMs,
        cache.lengthMs,
        false,
        this.overlayTrackCache,
        cache,
      ),
    );
  }

  getMediaDisplayLabel(): string {
    if (!this.host.source) return '';
    let title: string | undefined;
    try {
      if (this.host.getMediaInfo().parsed) {
        title = this.host.getMediaMetadata().title;
      }
    } catch {
      // ignore
    }
    return formatMediaDisplayLabel(this.host.source, title);
  }

  /** 后台解析元数据，供全屏左上角标题（有 title 显示 title，否则文件名） */
  scheduleMediaLabelParse(): void {
    if (!this.host.showControls || !this.host.source || this.host.playerId < 0) return;
    if (this.host.mediaLabelParseForSource === this.host.source) return;
    try {
      if (this.host.getMediaInfo().parsed) {
        this.host.mediaLabelParseForSource = this.host.source;
        this.host.pushState();
        return;
      }
    } catch {
      // ignore
    }
    this.host.mediaLabelParseForSource = this.host.source;
    void this.host
      .parseMedia({ timeoutMs: 0, maxWaitMs: 12000 })
      .then(() => this.host.pushState())
      .catch(() => this.host.pushState());
  }

  resetOverlayStateCache(): void {
    this.pendingUnmuteFromVolume = false;
    this.pendingUnmuteFromVolumeUntil = 0;
    this.overlayPlaybackCache = {
      lengthMs: 0,
      timeMs: 0,
      volume: 100,
      muted: false,
      rate: 1,
      fps: 0,
    };
    this.overlayTrackCache = {
      audioTracks: [],
      subtitleTracks: [],
      audioTrackId: -1,
      subtitleTrackId: -1,
    };
  }

  sendOverlayState(state: Record<string, unknown>): void {
    if (!this.overlay || this.overlay.isDestroyed() || this.host.playerId < 0) return;
    this.overlay.webContents.send('evp:state', this.host.playerId, state);
  }

  buildOverlayUiState(
    playing: boolean,
    timeMs: number,
    lengthMs: number,
    ended: boolean,
    trackOverlay: OverlayTrackCache,
    playback: Pick<OverlayPlaybackCache, 'fps' | 'volume' | 'muted' | 'rate'>,
  ): Record<string, unknown> {
    return {
      playing,
      timeMs,
      lengthMs,
      ended,
      hasMedia: !!this.host.source,
      fps: playback.fps,
      volume: playback.volume,
      muted: playback.muted,
      rate: playback.rate,
      pageFullscreen: this.host.isPageFullscreen(),
      fullScreen: this.host.isFullScreen(),
      showPageFullscreenButton: this.host.showPageFullscreenButton,
      mediaLabel: this.getMediaDisplayLabel(),
      playlistEnabled: this.host.hasPlaylistControls(),
      hasPrevious: this.host.hasPrevious(),
      hasNext: this.host.hasNext(),
      mediaToken: this.host.mediaToken,
      seekPreview: this.host.seekPreview.buildSeekPreviewPushState(),
      ...trackOverlay,
    };
  }

  /** Opening/Buffering 等过渡态不宜查轨表/fps，避免换源时 native 阻塞 */
  isOverlayHeavyQueryUnsafe(): boolean {
    try {
      const st = this.host.getState();
      return (
        st === VlcState.NothingSpecial ||
        st === VlcState.Opening ||
        st === VlcState.Buffering ||
        st === VlcState.Error
      );
    } catch {
      return true;
    }
  }

  /** 换源后立即刷新 overlay（不调用 libVLC，仅推送 cache + mediaToken） */
  pushOverlayCachedState(playing: boolean): void {
    if (!this.overlay || this.overlay.isDestroyed() || this.host.playerId < 0) return;
    const cache = this.overlayPlaybackCache;
    this.sendOverlayState(
      this.buildOverlayUiState(
        playing,
        cache.timeMs,
        cache.lengthMs,
        false,
        this.overlayTrackCache,
        cache,
      ),
    );
  }

  sendReplayOverlayState(cache: OverlayPlaybackCache): void {
    if (!this.overlay || this.overlay.isDestroyed()) return;
    this.sendOverlayState(
      this.buildOverlayUiState(true, 0, cache.lengthMs, false, this.overlayTrackCache, cache),
    );
  }

  /**
   * 同步 overlay 控制条状态。libVLC 3.x 在 Ended 后不宜再轮询轨表/fps/time API（易崩溃）。
   */
  pushState(): void {
    if (!this.overlay || this.overlay.isDestroyed() || this.host.playerId < 0) return;

    if (!this.host.source) {
      const cache = this.overlayPlaybackCache;
      this.sendOverlayState(
        this.buildOverlayUiState(
          false,
          0,
          0,
          false,
          this.overlayTrackCache,
          {
            fps: 0,
            volume: cache.volume,
            muted: cache.muted,
            rate: cache.rate || 1,
          },
        ),
      );
      return;
    }

    let ended = false;
    try {
      ended = this.host.getState() === VlcState.Ended;
    } catch {
      // ignore
    }

    const cache = this.overlayPlaybackCache;
    if (!ended && cache.lengthMs > 0 && cache.timeMs >= cache.lengthMs - SEEK_END_MARGIN_MS) {
      ended = true;
    }

    if (ended) {
      const lengthMs = cache.lengthMs > 0 ? cache.lengthMs : 0;
      this.sendOverlayState(
        this.buildOverlayUiState(
          false,
          lengthMs,
          lengthMs,
          true,
          this.overlayTrackCache,
          cache,
        ),
      );
      this.host.handlePlaybackEnd();
      return;
    }

    if (this.isOverlayHeavyQueryUnsafe()) {
      this.refreshOverlayPlaybackCacheFromNative();
      let playing = false;
      try {
        playing = getBinding().isPlaying(this.host.playerId);
      } catch {
        // ignore
      }
      this.sendOverlayState(
        this.buildOverlayUiState(
          playing,
          cache.timeMs,
          cache.lengthMs,
          false,
          this.overlayTrackCache,
          cache,
        ),
      );
      return;
    }

    const b = getBinding();
    const lengthMs = b.getLength(this.host.playerId);
    let timeMs = b.getTime(this.host.playerId);
    if (lengthMs > 0 && timeMs >= lengthMs - SEEK_END_MARGIN_MS) {
      timeMs = lengthMs;
    }

    let rate = cache.rate;
    try {
      rate = this.host.getRate();
    } catch {
      // ignore
    }
    if (Date.now() >= this.muteToggleGraceUntil) {
      this.syncOverlayMutedFromPlayer();
    }
    const muted = cache.muted;

    let fps = cache.fps;
    try {
      fps = this.host.getFps();
    } catch {
      // ignore
    }

    let volume = cache.volume;
    try {
      volume = this.normalizeVolumeLevel(b.getVolume(this.host.playerId));
    } catch {
      // ignore
    }

    let trackOverlay = this.overlayTrackCache;
    try {
      trackOverlay = this.host.getOverlayTrackState();
      this.overlayTrackCache = trackOverlay;
    } catch {
      // ignore
    }

    cache.lengthMs = lengthMs;
    cache.timeMs = timeMs;
    cache.volume = volume;
    cache.muted = muted;
    cache.rate = rate;
    cache.fps = fps;

    let playing = false;
    try {
      playing = b.isPlaying(this.host.playerId);
    } catch {
      // ignore
    }

    this.sendOverlayState(
      this.buildOverlayUiState(
        playing,
        timeMs,
        lengthMs,
        false,
        trackOverlay,
        { fps, volume, muted, rate },
      ),
    );
  }

  getOverlayTrackState(): OverlayTrackCache {
    return this.tracksMenu.getOverlayTrackState();
  }

  /** 控制条「添加字幕文件」：系统文件对话框 + libVLC 外挂字幕 */
  async pickAndAddSubtitleFile(): Promise<void> {
    if (this.host.playerId < 0 || this.host.window.isDestroyed()) return;
    this.hideOverlay();
    let result: OpenDialogReturnValue;
    try {
      result = await dialog.showOpenDialog(this.host.window, {
        title: this.host.strings.addSubtitleDialogTitle,
        properties: ['openFile'],
        filters: [
          {
            name: this.host.strings.subtitleFileFilter,
            extensions: [...SUBTITLE_FILE_EXTENSIONS],
          },
          { name: this.host.strings.allFilesFilter, extensions: ['*'] },
        ],
      });
    } finally {
      this.showOverlay();
      this.focusOverlay();
    }
    if (result.canceled || !result.filePaths[0]) return;
    const filePath = result.filePaths[0];
    const uri = pathToFileURL(filePath).href;
    const ok = this.host.addSubtitleFile(uri) || this.host.addSubtitleFile(filePath);
    if (ok) {
      this.host.pushState();
      return;
    }
    this.host.emit('openSubtitle', { filePath, canceled: false });
  }

  handleSetVolume(volume: number): void {
    if (this.overlayPlaybackCache.muted) {
      try {
        this.host.setMute(false);
      } catch {
        // ignore
      }
      this.overlayPlaybackCache.muted = false;
      this.pendingUnmuteFromVolume = true;
      this.pendingUnmuteFromVolumeUntil = Date.now() + 2000;
      this.muteToggleGraceUntil = Date.now() + 150;
    }
    const b = getBinding();
    const target = this.normalizeVolumeLevel(volume);
    b.setVolume(this.host.playerId, target);
    let actual = target;
    try {
      actual = this.normalizeVolumeLevel(b.getVolume(this.host.playerId));
    } catch {
      // ignore
    }
    this.overlayPlaybackCache.volume = actual;
    this.host.pushState();
  }

  handleToggleMute(): void {
    this.pendingUnmuteFromVolume = false;
    this.pendingUnmuteFromVolumeUntil = 0;
    const before = this.overlayPlaybackCache.muted;
    this.host.toggleMute();
    this.overlayPlaybackCache.muted = !before;
    this.muteToggleGraceUntil = Date.now() + 150;
    this.host.pushState();
  }
}
