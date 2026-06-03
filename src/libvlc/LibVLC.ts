import { EventEmitter } from 'node:events';

import { getBinding } from '../native';
import type {
  LibVlcVersionInfo,
  MediaInfo,
  MediaMetadata,
  MediaStreamInfo,
  TrackInfo,
  VideoSize,
  VlcBinding,
} from '../native';
import {
  MediaQueryCode,
  type MediaMetadataResult,
  type MediaParsedResult,
  type MediaTracksResult,
  type VlcPlayerEventPayload,
  type VlcSetSourceOptions,
  type VlcTrackChangedPayload,
  type VlcTrackKind,
  type MediaQueryCode as MediaQueryCodeType,
} from '../types';
import { VlcEvent, VlcState, VlcTrackType } from '../vlc-constants';
import { vlcEventName } from '../vlc-event-names';

export type {
  MediaMetadataResult,
  MediaParsedResult,
  MediaTracksResult,
  MediaQueryResult,
  VlcPlayerEventPayload,
  VlcTrackChangedPayload,
  VlcTrackKind,
} from '../types';

const MEDIA_QUERY_MESSAGES = {
  [MediaQueryCode.PLAYER_NOT_READY]: 'Player not ready',
  [MediaQueryCode.MEDIA_NOT_PARSED]: 'Media not parsed yet; call parseMedia() first',
  [MediaQueryCode.METADATA_UNAVAILABLE]: 'Unable to read metadata at this time',
  [MediaQueryCode.MEDIA_OPENING]:
    'Media is opening or buffering; retry later or use parseMedia() to wait until ready',
  [MediaQueryCode.TRACKS_SWITCHABLE_ONLY]:
    'libVLC 3.x exposes only switchable tracks while playing; stop playback for full stream details',
  [MediaQueryCode.TRACKS_PARTIAL]:
    'Detailed stream info unavailable; returned switchable track list instead',
  [MediaQueryCode.STREAM_INFO_UNAVAILABLE]: 'Unable to read stream info at this time',
} satisfies Record<MediaQueryCodeType, string>;

function mediaQueryMessage(code: MediaQueryCodeType, override?: string): string {
  return override ?? MEDIA_QUERY_MESSAGES[code];
}

/**
 * libVLC 媒体播放器 API（对应一个 native player id）。
 * 通常通过 `VlcPlayer` 直接使用；也可用 `LibVLC.forId(id)` 包装已有 id。
 */
interface ParseWaiter {
  generation: number;
  maxWaitMs: number;
  resolve: (value: MediaParsedResult) => void;
  reject: (reason: Error) => void;
}

interface DetailSafeWaiter {
  generation: number;
  requireParsed: boolean;
  resolve: () => void;
  reject: (reason: Error) => void;
}

const PARSE_POLL_MS = 250;
const PARSE_DEFAULT_MAX_WAIT_MS = 120_000;
/** 进入 Playing 等状态后稍等，避免 libVLC 内部仍处在 Opening 过渡期 */
const DETAIL_QUERY_SETTLE_MS = 400;

/** 可发起 parse / 读元数据（含 Playing，但不含 Opening / Buffering） */
const PLAYER_STABLE_FOR_WORK_STATES = new Set<number>([
  VlcState.Playing,
  VlcState.Paused,
  VlcState.Stopped,
  VlcState.Ended,
]);

export class LibVLC extends EventEmitter {
  private eventsHooked = false;
  /** 换源时递增，用于作废进行中的 parse Promise */
  private mediaGeneration = 0;
  private parseWaiters: ParseWaiter[] = [];
  private pendingParse: Promise<MediaParsedResult> | null = null;
  private parsePollTimer: ReturnType<typeof setInterval> | null = null;
  private detailSafeWaiters: DetailSafeWaiter[] = [];
  private detailSafePollTimer: ReturnType<typeof setInterval> | null = null;
  private lastEmittedTrackId: Record<VlcTrackKind, number | null> = {
    audio: null,
    video: null,
    subtitle: null,
  };

  constructor(
    private readonly resolvePlayerId: () => number,
    private readonly notEmbeddedMessage = 'call embed() first',
  ) {
    super();
  }

  /** 包装已有 native player id */
  static forId(playerId: number): LibVLC {
    return new LibVLC(() => playerId, 'invalid player id');
  }

  protected requirePlayerId(): number {
    const id = this.resolvePlayerId();
    if (id < 0) {
      throw new Error(`VlcPlayer is not embedded; ${this.notEmbeddedMessage}`);
    }
    return id;
  }

  private b(): VlcBinding {
    return getBinding();
  }

  private hasAnyListeners(): boolean {
    for (const event of this.eventNames()) {
      if (this.listenerCount(event) > 0) return true;
    }
    return false;
  }

  private hookEvents(): void {
    if (this.eventsHooked) return;
    this.eventsHooked = true;
    const id = this.requirePlayerId();
    this.b().setPlayerEventHandler(id, (payload: VlcPlayerEventPayload) => {
      if (payload.type === VlcEvent.MediaParsedChanged) {
        this.finishParseWaiters();
        this.flushDetailSafeWaiters();
        return;
      }
      if (payload.type === VlcEvent.MediaPlayerESSelected) {
        this.handleTrackSelectedEvent(payload);
        return;
      }
      const name = vlcEventName(payload.type);
      this.emit(name, payload);
      this.emit('event', name, payload);
      this.flushDetailSafeWaiters();
    });
  }

  /** 无 JS 监听器时解除 native 回调（不影响其它播放器实例） */
  private unhookEvents(): void {
    if (!this.eventsHooked) return;
    try {
      this.b().setPlayerEventHandler(this.resolvePlayerId(), null);
    } catch {
      // player may already be destroyed
    }
    this.eventsHooked = false;
  }

  private maybeUnhookEvents(): void {
    if (this.parseWaiters.length > 0 || this.pendingParse || this.detailSafeWaiters.length > 0) {
      return;
    }
    if (this.eventsHooked && !this.hasAnyListeners()) {
      this.unhookEvents();
    }
  }

  override on(event: string | symbol, listener: (...args: unknown[]) => void): this {
    this.hookEvents();
    return super.on(event, listener);
  }

  override once(event: string | symbol, listener: (...args: unknown[]) => void): this {
    this.hookEvents();
    return super.once(event, listener);
  }

  override addListener(event: string | symbol, listener: (...args: unknown[]) => void): this {
    this.hookEvents();
    return super.addListener(event, listener);
  }

  override prependListener(event: string | symbol, listener: (...args: unknown[]) => void): this {
    this.hookEvents();
    return super.prependListener(event, listener);
  }

  override off(event: string | symbol, listener: (...args: unknown[]) => void): this {
    super.off(event, listener);
    this.maybeUnhookEvents();
    return this;
  }

  override removeListener(event: string | symbol, listener: (...args: unknown[]) => void): this {
    super.removeListener(event, listener);
    this.maybeUnhookEvents();
    return this;
  }

  override removeAllListeners(event?: string | symbol): this {
    super.removeAllListeners(event);
    this.maybeUnhookEvents();
    return this;
  }

  override emit(event: string | symbol, ...args: unknown[]): boolean {
    const result = super.emit(event, ...args);
    this.maybeUnhookEvents();
    return result;
  }

  setSource(src: string, options?: VlcSetSourceOptions): void {
    const trimmed = src?.trim();
    if (!trimmed) throw new Error('setSource requires a non-empty path or URL');
    this.hookEvents();
    this.cancelParseWaiters(new Error('Media source changed'));
    this.mediaGeneration += 1;
    this.resetTrackChangeDedup();
    const id = this.requirePlayerId();
    const autoplay = options?.autoplay !== false;
    const mediaOptions = options?.mediaOptions;
    if (mediaOptions?.length) {
      this.b().setMediaEx(id, trimmed, autoplay, mediaOptions);
    } else {
      this.b().setMedia(id, trimmed, autoplay);
    }
  }

  getMediaInfo(): MediaInfo {
    return this.b().getMediaInfo(this.requirePlayerId());
  }

  /**
   * 显式触发 libVLC 媒体解析（与 VLC 默认行为一致，换源后不会自动 parse）。
   * 解析完成后 resolve，并附带元数据、轨列表等，无需再调用 `getMediaMetadata` / `getMediaTracks`。
   *
   * @param options.timeoutMs 默认 `0`（异步，立即返回 Promise，完成时 resolve）；
   *   `>0` 时在 native 层阻塞至多该毫秒数（适合脚本/测试）。
   * @param options.maxWaitMs 异步模式下轮询的最长等待（默认 120000）；超时 reject。
   *   含「等待 parsed」与「等待可安全读取轨信息」两阶段。
   */
  parseMedia(options?: { timeoutMs?: number; maxWaitMs?: number }): Promise<MediaParsedResult> {
    this.hookEvents();
    const timeoutMs = options?.timeoutMs ?? 0;
    const maxWaitMs = options?.maxWaitMs ?? PARSE_DEFAULT_MAX_WAIT_MS;
    const generation = this.mediaGeneration;

    if (this.getMediaInfo().parsed) {
      return this.waitUntilPlayerStableForMediaWork(generation, maxWaitMs)
        .then(() => this.settleBeforeMediaDetailQuery())
        .then(() => {
          this.assertParseGeneration(generation);
          return this.buildMediaParsedResult();
        });
    }
    if (this.pendingParse) {
      return this.pendingParse;
    }

    const run = async (): Promise<MediaParsedResult> => {
      await this.waitUntilPlayerStableForMediaWork(generation, maxWaitMs);
      this.assertParseGeneration(generation);

      if (timeoutMs > 0) {
        const ok = this.b().parseMedia(this.requirePlayerId(), timeoutMs);
        this.assertParseGeneration(generation);
        if (!ok || !this.getMediaInfo().parsed) {
          throw new Error('Failed to parse media');
        }
        await this.settleBeforeMediaDetailQuery();
        this.assertParseGeneration(generation);
        return this.buildMediaParsedResult();
      }

      return new Promise<MediaParsedResult>((resolve, reject) => {
        this.parseWaiters.push({
          generation,
          maxWaitMs,
          resolve,
          reject,
        });
        this.startParsePoll(generation, maxWaitMs);
        try {
          this.b().parseMedia(this.requirePlayerId(), 0);
        } catch (err) {
          this.stopParsePoll();
          this.removeParseWaiter(resolve, reject);
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        this.assertParseGeneration(generation);
        if (this.getMediaInfo().parsed) {
          this.finishParseWaiters();
        }
      });
    };

    const promise = run().finally(() => {
      if (this.pendingParse === promise) {
        this.pendingParse = null;
      }
    });
    this.pendingParse = promise;
    return promise;
  }

  private assertParseGeneration(generation: number): void {
    if (generation !== this.mediaGeneration) {
      throw new Error('Media source changed');
    }
  }

  private cancelParseWaiters(reason: Error): void {
    this.stopParsePoll();
    this.cancelDetailSafeWaiters(reason);
    const waiters = this.parseWaiters;
    this.parseWaiters = [];
    this.pendingParse = null;
    for (const w of waiters) {
      w.reject(reason);
    }
  }

  private settleBeforeMediaDetailQuery(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, DETAIL_QUERY_SETTLE_MS));
  }

  /** 播放器是否已离开 Opening/Buffering（不要求已 parse） */
  isPlayerStableForMediaWork(): boolean {
    try {
      return PLAYER_STABLE_FOR_WORK_STATES.has(this.getState());
    } catch {
      return false;
    }
  }

  /**
   * 媒体已解析且可读取完整轨表（libVLC 3：Stopped/Ended 时调用 `libvlc_media_tracks_get`）。
   */
  canQueryNativeMediaTracks(): boolean {
    const info = this.getMediaInfoForQuery();
    if (!info?.parsed) return false;
    if (!this.isPlayerStableForMediaWork()) return false;
    try {
      const st = this.getState();
      if (st === VlcState.Paused) return false;
      return st === VlcState.Stopped || st === VlcState.Ended;
    } catch {
      return false;
    }
  }

  /** 等待 {@link isPlayerStableForMediaWork}（`parseMedia()` 在发起 native parse 前会调用） */
  waitUntilPlayerStableForMediaWork(
    generation?: number,
    maxWaitMs: number = PARSE_DEFAULT_MAX_WAIT_MS,
  ): Promise<void> {
    return this.waitForDetailQueryWindow(generation, maxWaitMs, false);
  }

  private isDetailQueryWindowReady(requireParsed: boolean): boolean {
    if (requireParsed) return this.canQueryNativeMediaTracks();
    return this.isPlayerStableForMediaWork();
  }

  private waitForDetailQueryWindow(
    generation: number | undefined,
    maxWaitMs: number,
    requireParsed: boolean,
  ): Promise<void> {
    const gen = generation ?? this.mediaGeneration;
    if (this.isDetailQueryWindowReady(requireParsed)) {
      return Promise.resolve();
    }
    this.hookEvents();
    return new Promise<void>((resolve, reject) => {
      const waiter: DetailSafeWaiter = { generation: gen, requireParsed, resolve, reject };
      this.detailSafeWaiters.push(waiter);
      this.startDetailSafePoll(gen, maxWaitMs);
    });
  }

  private cancelDetailSafeWaiters(reason: Error): void {
    this.stopDetailSafePoll();
    const waiters = this.detailSafeWaiters;
    this.detailSafeWaiters = [];
    for (const w of waiters) {
      if (w.generation !== this.mediaGeneration) {
        w.reject(new Error('Media source changed'));
      } else {
        w.reject(reason);
      }
    }
  }

  private stopDetailSafePoll(): void {
    if (this.detailSafePollTimer != null) {
      clearInterval(this.detailSafePollTimer);
      this.detailSafePollTimer = null;
    }
  }

  private startDetailSafePoll(generation: number, maxWaitMs: number): void {
    if (this.detailSafePollTimer != null) return;
    const started = Date.now();
    this.detailSafePollTimer = setInterval(() => {
      if (generation !== this.mediaGeneration) {
        this.cancelDetailSafeWaiters(new Error('Media source changed'));
        return;
      }
      this.flushDetailSafeWaiters();
      if (this.detailSafeWaiters.length === 0) {
        return;
      }
      if (Date.now() - started >= maxWaitMs) {
        this.cancelDetailSafeWaiters(new Error('Timed out waiting for safe media detail query window'));
      }
    }, PARSE_POLL_MS);
  }

  private flushDetailSafeWaiters(): void {
    const ready = this.detailSafeWaiters.filter(
      (w) =>
        w.generation === this.mediaGeneration &&
        this.isDetailQueryWindowReady(w.requireParsed),
    );
    if (!ready.length) return;
    this.detailSafeWaiters = this.detailSafeWaiters.filter((w) => !ready.includes(w));
    if (this.detailSafeWaiters.length === 0) {
      this.stopDetailSafePoll();
    }
    for (const w of ready) {
      w.resolve();
    }
  }

  private stopParsePoll(): void {
    if (this.parsePollTimer != null) {
      clearInterval(this.parsePollTimer);
      this.parsePollTimer = null;
    }
  }

  private startParsePoll(generation: number, maxWaitMs: number): void {
    this.stopParsePoll();
    const started = Date.now();
    this.parsePollTimer = setInterval(() => {
      if (generation !== this.mediaGeneration) {
        this.stopParsePoll();
        return;
      }
      if (this.getMediaInfo().parsed) {
        this.finishParseWaiters();
        return;
      }
      if (Date.now() - started >= maxWaitMs) {
        this.rejectParseWaiters(new Error('Media parse timed out'));
      }
    }, PARSE_POLL_MS);
  }

  private rejectParseWaiters(reason: Error): void {
    this.stopParsePoll();
    const waiters = this.parseWaiters;
    this.parseWaiters = [];
    this.pendingParse = null;
    for (const w of waiters) {
      if (w.generation !== this.mediaGeneration) {
        w.reject(new Error('Media source changed'));
      } else {
        w.reject(reason);
      }
    }
  }

  private removeParseWaiter(
    resolve: (value: MediaParsedResult) => void,
    reject: (reason: Error) => void,
  ): void {
    this.parseWaiters = this.parseWaiters.filter(
      (w) => w.resolve !== resolve || w.reject !== reject,
    );
  }

  private finishParseWaiters(): void {
    this.stopParsePoll();
    const waiters = this.parseWaiters;
    this.parseWaiters = [];
    for (const w of waiters) {
      void this.resolveParseWaiterWhenSafe(w);
    }
  }

  private async resolveParseWaiterWhenSafe(w: ParseWaiter): Promise<void> {
    if (w.generation !== this.mediaGeneration) {
      w.reject(new Error('Media source changed'));
      return;
    }
    try {
      if (!this.getMediaInfo().parsed) {
        w.reject(new Error('Media parse completed but media is not marked parsed'));
        return;
      }
      await this.settleBeforeMediaDetailQuery();
      this.assertParseGeneration(w.generation);
      w.resolve(this.buildMediaParsedResult());
    } catch (err) {
      w.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private buildMediaParsedResult(): MediaParsedResult {
    const metaR = this.getMediaMetadataResult();
    const tracksR = this.getMediaTracksResult();
    return {
      info: this.getMediaInfo(),
      metadata: metaR.data,
      tracks: tracksR.data,
      tracksCode: tracksR.code,
      tracksMessage: tracksR.message,
      length: this.getLength(),
    };
  }

  /** 是否处于打开/缓冲/播放中 */
  isInActivePlayback(): boolean {
    try {
      const state = this.getState();
      return (
        state === VlcState.Opening ||
        state === VlcState.Buffering ||
        state === VlcState.Playing
      );
    } catch {
      return false;
    }
  }

  private getMediaInfoForQuery(): MediaInfo | null {
    try {
      return this.getMediaInfo();
    } catch {
      return null;
    }
  }

  private tracksFromPlayerDescriptions(): MediaStreamInfo[] {
    const tracks: MediaStreamInfo[] = [];
    const push = (type: MediaStreamInfo['type'], list: TrackInfo[]) => {
      for (const t of list) {
        // libvlc_*_get_track_description 含 i_id=-1 的「禁用」项，供 setTrack(-1) 用，不是媒体流
        if (t.id < 0) continue;
        tracks.push({
          id: t.id,
          type,
          description: t.name || undefined,
          codec: t.name || undefined,
        });
      }
    };
    try {
      push('video', this.getVideoTracks());
      push('audio', this.getAudioTracks());
      push('subtitle', this.getSubtitleTracks());
    } catch {
      // ignore
    }
    return tracks;
  }

  /**
   * 读取元数据（标题、艺术家等）。任意时刻可调用；未就绪时 `data` 为空对象，见 `code` / `message`。
   */
  getMediaMetadataResult(): MediaMetadataResult {
    const info = this.getMediaInfoForQuery();
    if (!info) {
      const code = MediaQueryCode.PLAYER_NOT_READY;
      return { data: {}, code, message: mediaQueryMessage(code) };
    }
    if (!info.parsed) {
      const code = MediaQueryCode.MEDIA_NOT_PARSED;
      return { data: {}, code, message: mediaQueryMessage(code) };
    }
    try {
      const data = this.b().getMediaMetadata(this.requirePlayerId(), false, 0);
      return { data };
    } catch {
      const code = MediaQueryCode.METADATA_UNAVAILABLE;
      return { data: {}, code, message: mediaQueryMessage(code) };
    }
  }

  getMediaMetadata(): MediaMetadata {
    return this.getMediaMetadataResult().data;
  }

  private tracksResultFromPlayerDescriptions(
    code: MediaQueryCodeType,
    message?: string,
  ): MediaTracksResult {
    const fallback = this.tracksFromPlayerDescriptions();
    if (!fallback.length) {
      return { data: [] };
    }
    return {
      data: fallback,
      code,
      message: mediaQueryMessage(code, message),
    };
  }

  /**
   * 读取各条音视频/字幕流信息。Stopped/Ended 时调用 `libvlc_media_tracks_get`，否则退回可切换轨。
   */
  getMediaTracksResult(): MediaTracksResult {
    const info = this.getMediaInfoForQuery();
    if (!info) {
      const code = MediaQueryCode.PLAYER_NOT_READY;
      return { data: [], code, message: mediaQueryMessage(code) };
    }
    if (!info.parsed) {
      const code = MediaQueryCode.MEDIA_NOT_PARSED;
      return { data: [], code, message: mediaQueryMessage(code) };
    }
    if (!this.isPlayerStableForMediaWork()) {
      const code = MediaQueryCode.MEDIA_OPENING;
      return { data: [], code, message: mediaQueryMessage(code) };
    }
    if (!this.canQueryNativeMediaTracks()) {
      return this.tracksResultFromPlayerDescriptions(MediaQueryCode.TRACKS_SWITCHABLE_ONLY);
    }

    try {
      const data = this.b().getMediaTracks(this.requirePlayerId(), false, 0);
      if (data.length > 0) {
        return { data };
      }
      const fallback = this.tracksFromPlayerDescriptions();
      if (fallback.length > 0) {
        const code = MediaQueryCode.TRACKS_PARTIAL;
        return {
          data: fallback,
          code,
          message: mediaQueryMessage(code),
        };
      }
      return { data: [] };
    } catch {
      const fallback = this.tracksFromPlayerDescriptions();
      if (fallback.length) {
        const code = MediaQueryCode.TRACKS_PARTIAL;
        return {
          data: fallback,
          code,
          message: mediaQueryMessage(
            code,
            'Failed to read stream info; returned switchable track list instead',
          ),
        };
      }
      const code = MediaQueryCode.STREAM_INFO_UNAVAILABLE;
      return { data: [], code, message: mediaQueryMessage(code) };
    }
  }

  getMediaTracks(): MediaStreamInfo[] {
    return this.getMediaTracksResult().data;
  }

  play(): void {
    this.b().play(this.requirePlayerId());
  }
  pause(): void {
    this.b().pause(this.requirePlayerId());
  }
  stop(): void {
    this.b().stop(this.requirePlayerId());
  }
  togglePause(): void {
    this.b().togglePause(this.requirePlayerId());
  }
  setPaused(paused: boolean): void {
    this.b().setPause(this.requirePlayerId(), paused);
  }

  isPlaying(): boolean {
    return this.b().isPlaying(this.requirePlayerId());
  }
  isPaused(): boolean {
    return this.b().isPaused(this.requirePlayerId());
  }
  willPlay(): boolean {
    return this.b().willPlay(this.requirePlayerId());
  }
  canPause(): boolean {
    return this.b().canPause(this.requirePlayerId());
  }
  isSeekable(): boolean {
    return this.b().isSeekable(this.requirePlayerId());
  }
  hasVout(): boolean {
    return this.b().hasVout(this.requirePlayerId());
  }
  getState(): number {
    return this.b().getState(this.requirePlayerId());
  }

  getTime(): number {
    return this.b().getTime(this.requirePlayerId());
  }
  setTime(ms: number): void {
    this.b().setTime(this.requirePlayerId(), ms);
  }
  getLength(): number {
    return this.b().getLength(this.requirePlayerId());
  }
  getPosition(): number {
    return this.b().getPosition(this.requirePlayerId());
  }
  setPosition(position: number): void {
    this.b().setPosition(this.requirePlayerId(), position);
  }
  getRate(): number {
    return this.b().getRate(this.requirePlayerId());
  }
  setRate(rate: number): void {
    this.b().setRate(this.requirePlayerId(), rate);
  }
  getFps(): number {
    return this.b().getFps(this.requirePlayerId());
  }

  getVolume(): number {
    return this.b().getVolume(this.requirePlayerId());
  }
  setVolume(volume: number): void {
    this.b().setVolume(this.requirePlayerId(), volume);
  }
  toggleMute(): void {
    this.b().toggleMute(this.requirePlayerId());
  }
  getMute(): boolean {
    return this.b().getMute(this.requirePlayerId());
  }
  setMute(mute: boolean): void {
    this.b().setMute(this.requirePlayerId(), mute);
  }
  getAudioChannel(): number {
    return this.b().getAudioChannel(this.requirePlayerId());
  }
  setAudioChannel(channel: number): void {
    this.b().setAudioChannel(this.requirePlayerId(), channel);
  }
  getAudioDelay(): number {
    return this.b().getAudioDelay(this.requirePlayerId());
  }
  setAudioDelay(delayUs: number): void {
    this.b().setAudioDelay(this.requirePlayerId(), delayUs);
  }
  getAudioTracks(): TrackInfo[] {
    return this.b().getAudioTracks(this.requirePlayerId());
  }
  getAudioTrack(): number {
    return this.b().getAudioTrack(this.requirePlayerId());
  }
  setAudioTrack(trackId: number): void {
    this.b().setAudioTrack(this.requirePlayerId(), trackId);
    this.emitTrackChanged('audio', trackId);
  }

  getSubtitleTracks(): TrackInfo[] {
    return this.b().getSubtitleTracks(this.requirePlayerId());
  }
  getSubtitleTrack(): number {
    return this.b().getSubtitleTrack(this.requirePlayerId());
  }
  setSubtitleTrack(trackId: number): void {
    this.b().setSubtitleTrack(this.requirePlayerId(), trackId);
    this.emitTrackChanged('subtitle', trackId);
  }

  /** 为当前播放加载外挂字幕文件（LibVLC `add_slave`；uri 建议使用 `pathToFileURL`） */
  addSubtitleFile(uri: string): boolean {
    const trimmed = uri?.trim();
    if (!trimmed) return false;
    return this.b().addSubtitleFile(this.requirePlayerId(), trimmed);
  }

  getVideoTracks(): TrackInfo[] {
    return this.b().getVideoTracks(this.requirePlayerId());
  }
  getVideoTrack(): number {
    return this.b().getVideoTrack(this.requirePlayerId());
  }
  setVideoTrack(trackId: number): void {
    this.b().setVideoTrack(this.requirePlayerId(), trackId);
    this.emitTrackChanged('video', trackId);
  }

  private resetTrackChangeDedup(): void {
    this.lastEmittedTrackId.audio = null;
    this.lastEmittedTrackId.video = null;
    this.lastEmittedTrackId.subtitle = null;
  }

  private trackKindFromNative(trackType: number): VlcTrackKind | null {
    switch (trackType) {
      case VlcTrackType.Audio:
        return 'audio';
      case VlcTrackType.Video:
        return 'video';
      case VlcTrackType.Subtitle:
        return 'subtitle';
      default:
        return null;
    }
  }

  private trackChangedEventName(kind: VlcTrackKind): string {
    return `${kind}TrackChanged`;
  }

  /** 向 JS 发送轨道切换事件（自带菜单 / set*Track / libVLC ESSelected 共用） */
  private emitTrackChanged(kind: VlcTrackKind, trackId: number): void {
    if (this.lastEmittedTrackId[kind] === trackId) return;
    this.lastEmittedTrackId[kind] = trackId;
    const payload: VlcTrackChangedPayload = {
      type: VlcEvent.MediaPlayerESSelected,
      trackId,
    };
    const name = this.trackChangedEventName(kind);
    this.emit(name, payload);
    this.emit('event', name, payload);
  }

  private handleTrackSelectedEvent(payload: VlcPlayerEventPayload): void {
    const trackType = payload.trackType;
    const trackId = payload.trackId;
    if (trackType === undefined || trackId === undefined) return;
    const kind = this.trackKindFromNative(trackType);
    if (!kind) return;
    this.emitTrackChanged(kind, trackId);
  }
  getScale(): number {
    return this.b().getScale(this.requirePlayerId());
  }
  setScale(scale: number): void {
    this.b().setScale(this.requirePlayerId(), scale);
  }
  getAspectRatio(): string {
    return this.b().getAspectRatio(this.requirePlayerId());
  }
  setAspectRatio(ratio: string): void {
    this.b().setAspectRatio(this.requirePlayerId(), ratio);
  }
  setCropGeometry(geometry: string): void {
    this.b().setCropGeometry(this.requirePlayerId(), geometry);
  }
  getVideoSize(): VideoSize {
    return this.b().getVideoSize(this.requirePlayerId());
  }
  getDeinterlace(): string {
    return this.b().getDeinterlace(this.requirePlayerId());
  }
  setDeinterlace(mode: string): void {
    this.b().setDeinterlace(this.requirePlayerId(), mode);
  }
  takeSnapshot(filepath: string, num = 0, width = 0, height = 0): boolean {
    return this.b().takeSnapshot(this.requirePlayerId(), filepath, num, width, height);
  }

  getChapter(): number {
    return this.b().getChapter(this.requirePlayerId());
  }
  setChapter(chapter: number): void {
    this.b().setChapter(this.requirePlayerId(), chapter);
  }
  getChapterCount(): number {
    return this.b().getChapterCount(this.requirePlayerId());
  }
  getChapterDescriptions(titleIndex = -1): TrackInfo[] {
    return this.b().getChapterDescriptions(this.requirePlayerId(), titleIndex);
  }
  getTitleIndex(): number {
    return this.b().getTitleIndex(this.requirePlayerId());
  }
  setTitleIndex(title: number): void {
    this.b().setTitleIndex(this.requirePlayerId(), title);
  }
  getTitleCount(): number {
    return this.b().getTitleCount(this.requirePlayerId());
  }
  getTitleDescriptions(titleIndex = -1): TrackInfo[] {
    return this.b().getTitleDescriptions(this.requirePlayerId(), titleIndex);
  }
  nextChapter(): void {
    this.b().nextChapter(this.requirePlayerId());
  }
  previousChapter(): void {
    this.b().previousChapter(this.requirePlayerId());
  }
  navigate(mode: number): void {
    this.b().navigate(this.requirePlayerId(), mode);
  }

  getVlcFullscreen(): boolean {
    return this.b().getVlcFullscreen(this.requirePlayerId());
  }
  setVlcFullscreen(fullscreen: boolean): void {
    this.b().setVlcFullscreen(this.requirePlayerId(), fullscreen);
  }

  getRole(): number {
    return this.b().getRole(this.requirePlayerId());
  }
  setRole(role: number): void {
    this.b().setRole(this.requirePlayerId(), role);
  }
}

/** 在 initLibVlc 之后查询 libVLC 版本信息 */
export function getLibVlcVersion(): LibVlcVersionInfo {
  return getBinding().getLibVlcVersion();
}
