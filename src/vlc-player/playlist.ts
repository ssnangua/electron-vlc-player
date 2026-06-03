import { getBinding } from '../native';
import { VlcState } from '../vlc-constants';
import type { VlcPlaylistItemChangedPayload, VlcPlaybackMode } from '../types';
import { normalizePlaybackMode, SEEK_END_MARGIN_MS } from './constants';
import type { VlcPlayerHost } from './host';

export class PlaylistController {
  playlistPaths: string[] = [];
  playlistIndex = -1;
  playbackMode: VlcPlaybackMode = 'default';
  playlistAutoAdvanceInFlight = false;

  constructor(private readonly host: VlcPlayerHost) {}

  /** 是否已配置可切换的播放列表（至少 2 条） */
  hasPlaylistControls(): boolean {
    return this.playlistPaths.length > 1;
  }

  getPlaylist(): readonly string[] {
    return this.playlistPaths;
  }

  getPlaylistIndex(): number {
    return this.playlistIndex;
  }

  hasPrevious(): boolean {
    if (this.playbackMode === 'loop' && this.hasPlaylistControls()) return true;
    return this.hasPlaylistControls() && this.playlistIndex > 0;
  }

  /** 列表内是否还有「顺序上的下一项」（不含 loop 回绕） */
  hasNextInOrder(): boolean {
    return (
      this.hasPlaylistControls() &&
      this.playlistIndex >= 0 &&
      this.playlistIndex < this.playlistPaths.length - 1
    );
  }

  hasNext(): boolean {
    if (this.playbackMode === 'loop' && this.hasPlaylistControls()) return true;
    return this.hasNextInOrder();
  }

  /**
   * 设置播放列表（供控制条「播放上一个媒体 / 播放下一个媒体」）。少于 2 条时隐藏对应按钮。
   */
  setPlaylist(paths: string[]): void {
    this.playlistPaths = paths.map((p) => p.trim()).filter(Boolean);
    this.syncPlaylistIndexToSource();
    this.host.pushState();
  }

  playPrevious(): boolean {
    if (this.playbackMode === 'loop' && this.hasPlaylistControls() && this.playlistIndex <= 0) {
      return this.playItemAt(this.playlistPaths.length - 1);
    }
    if (!this.hasPrevious()) return false;
    return this.playItemAt(this.playlistIndex - 1);
  }

  playNext(): boolean {
    if (this.playbackMode === 'loop' && this.hasPlaylistControls() && !this.hasNextInOrder()) {
      return this.playItemAt(0);
    }
    if (!this.hasNextInOrder()) return false;
    return this.playItemAt(this.playlistIndex + 1);
  }

  /** 片尾播放模式：`default` | `loop`（列表循环）| `repeat`（单曲循环） */
  getPlaybackMode(): VlcPlaybackMode {
    return this.playbackMode;
  }

  setPlaybackMode(mode: VlcPlaybackMode): void {
    this.playbackMode = normalizePlaybackMode(mode);
    this.syncPlaybackEndListeners();
    this.host.pushState();
  }

  syncPlaylistIndexToSource(): void {
    if (!this.host.source) {
      this.playlistIndex = -1;
      return;
    }
    this.playlistIndex = this.playlistPaths.indexOf(this.host.source);
  }

  playItemAt(index: number): boolean {
    const src = this.playlistPaths[index];
    if (!src || !this.host.isEmbedded()) return false;
    this.playlistIndex = index;
    this.host.setSource(src);
    const payload: VlcPlaylistItemChangedPayload = { src, index };
    this.host.emit('playlistItemChanged', payload);
    return true;
  }

  /** 当前媒体是否已自然播完（片尾最后一帧 / Ended） */
  isMediaNaturallyComplete(): boolean {
    if (!this.host.isEmbedded() || this.host.playerId < 0) return false;
    const cache = this.host.overlayWindow.overlayPlaybackCache;
    const atEndPosition =
      cache.lengthMs > 0 && cache.timeMs >= cache.lengthMs - SEEK_END_MARGIN_MS;
    try {
      const st = this.host.getState();
      if (st === VlcState.Ended) return true;
      const b = getBinding();
      const playing = b.isPlaying(this.host.playerId);
      if (atEndPosition && !playing) return true;
      if (atEndPosition && (st === VlcState.Stopped || st === VlcState.Paused)) {
        return true;
      }
      if (!playing && this.host.getPosition() >= 0.995) return true;
    } catch {
      return atEndPosition;
    }
    return false;
  }

  /** 播放列表自动切下一首 / 循环 / 单曲重播（去重；换源 grace 期内不触发） */
  handlePlaybackEnd(): void {
    if (!this.host.source) return;
    if (this.playbackMode === 'default' && !this.host.autoAdvancePlaylist) return;
    if (
      this.playlistAutoAdvanceInFlight ||
      this.host.grace.sourceChangeInProgress ||
      this.host.destroyed ||
      this.host.playerId < 0 ||
      this.host.overlaySeek.overlayScrubSession.active ||
      this.host.replayInProgress
    ) {
      return;
    }
    if (!this.isMediaNaturallyComplete()) return;

    this.playlistAutoAdvanceInFlight = true;
    queueMicrotask(() => {
      this.playlistAutoAdvanceInFlight = false;
      if (
        this.host.grace.sourceChangeInProgress ||
        this.host.destroyed ||
        this.host.playerId < 0 ||
        this.host.overlaySeek.overlayScrubSession.active ||
        this.host.replayInProgress
      ) {
        return;
      }
      if (!this.isMediaNaturallyComplete()) return;

      if (this.playbackMode === 'repeat') {
        this.host.replayFromStart();
        return;
      }

      if (this.playbackMode === 'loop') {
        if (this.playlistPaths.length >= 2 && this.playlistIndex >= 0) {
          const nextIndex = this.hasNextInOrder() ? this.playlistIndex + 1 : 0;
          this.playItemAt(nextIndex);
          return;
        }
        if (this.host.source) {
          this.host.replayFromStart();
        }
        return;
      }

      if (!this.host.autoAdvancePlaylist || !this.hasNext()) return;
      this.playNext();
    });
  }

  private readonly onPlaylistAutoAdvance = (): void => {
    this.handlePlaybackEnd();
  };

  /** 部分 libVLC 版本片尾只发 Stopped 不发 EndReached */
  private readonly onPlaylistAutoAdvanceFromStop = (): void => {
    this.handlePlaybackEnd();
  };

  syncPlaybackEndListeners(): void {
    if (this.host.playerId < 0) return;
    this.host.off('endReached', this.onPlaylistAutoAdvance);
    this.host.off('stopped', this.onPlaylistAutoAdvanceFromStop);
    if (this.host.autoAdvancePlaylist || this.playbackMode !== 'default') {
      this.host.on('endReached', this.onPlaylistAutoAdvance);
      this.host.on('stopped', this.onPlaylistAutoAdvanceFromStop);
    }
  }

  /** 是否处于「已播完」：Ended/Stopped，或 overlay 缓存已到片尾（Ended 下勿再调 getTime/getLength） */
  shouldReplayFromStart(): boolean {
    if (!this.host.isEmbedded()) return false;
    try {
      const st = this.host.getState();
      if (st === VlcState.Ended || st === VlcState.Stopped) return true;
      const cache = this.host.overlayWindow.overlayPlaybackCache;
      if (cache.lengthMs > 0 && cache.timeMs >= cache.lengthMs - SEEK_END_MARGIN_MS) {
        return true;
      }
      if (st === VlcState.Playing || st === VlcState.Paused) {
        const pos = this.host.getPosition();
        if (pos >= 0.995) return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  /** 播完后重播：Ended 下仅 setTime+play 常无效，须 stop 再从头 play */
  replayFromStart(): void {
    if (!this.host.isEmbedded()) return;
    this.host.replayInProgress = true;
    this.host.markSeekGrace();
    this.host.grace.suppressEndReached(2000);

    const id = this.host.playerId;
    if (id < 0) return;
    const b = getBinding();
    const cache = this.host.overlayWindow.overlayPlaybackCache;
    const lengthMs = cache.lengthMs;

    try {
      b.stop(id);
    } catch {
      // ignore
    }
    try {
      b.setPosition(id, 0);
    } catch {
      try {
        b.setTime(id, 0);
      } catch {
        // ignore
      }
    }
    try {
      b.play(id);
    } catch {
      // ignore
    }

    cache.timeMs = 0;
    if (lengthMs > 0) cache.lengthMs = lengthMs;
    this.host.overlayWindow.sendReplayOverlayState(cache);

    setTimeout(() => {
      this.host.replayInProgress = false;
      if (this.host.destroyed || this.host.playerId < 0) return;
      this.host.overlaySeek.scheduleOverlayProgressAfterSeek();
      this.host.pushState();
    }, 150);
  }
}
