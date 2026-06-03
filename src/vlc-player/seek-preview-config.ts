import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clearSeekPreviewCacheRoot,
  isLocalMediaSource,
  previewMediaKeyFromSource,
  readSpriteIndex,
  removeSpriteWorkDir,
  resolveFfmpegExecutable,
  resolveLocalPathForFfmpeg,
  runGenerateSeekPreviewSprite,
  SEEK_PREVIEW_THUMB_H,
  SEEK_PREVIEW_THUMB_W,
} from '../seek-preview-sprite';
import { seekPreviewSpriteUrl, updateSeekPreviewProtocolCacheRoot } from '../preview-protocol';
import type { VlcPlayerHost } from './host';

export class SeekPreviewController {
  private static previewCacheDir = path.join(os.tmpdir(), 'evp-preview');
  private static ffmpegPath = '';
  private static ffmpegMissingInfoLogged = false;
  private static readonly seekPreviewActiveAborts = new Set<AbortController>();

  seekPreviewAbort: AbortController | null = null;
  seekPreviewGenerating = false;
  seekPreviewPercent = 0;

  constructor(private readonly host: VlcPlayerHost) {}

  static getSeekPreviewCacheDir(): string {
    return SeekPreviewController.previewCacheDir;
  }

  static setSeekPreviewCacheDir(dir: string): void {
    const trimmed = dir?.trim();
    if (!trimmed) {
      throw new Error('setSeekPreviewCacheDir requires a non-empty directory path');
    }
    SeekPreviewController.previewCacheDir = path.resolve(trimmed);
    updateSeekPreviewProtocolCacheRoot(SeekPreviewController.previewCacheDir);
  }

  static clearSeekPreviewCacheDir(): void {
    for (const ac of SeekPreviewController.seekPreviewActiveAborts) {
      ac.abort();
    }
    SeekPreviewController.seekPreviewActiveAborts.clear();
    clearSeekPreviewCacheRoot(SeekPreviewController.previewCacheDir);
  }

  static setFfmpegPath(ffmpegPath: string): void {
    SeekPreviewController.ffmpegPath = ffmpegPath?.trim() ?? '';
    if (resolveFfmpegExecutable(SeekPreviewController.ffmpegPath)) {
      SeekPreviewController.ffmpegMissingInfoLogged = false;
    }
  }

  static getFfmpegPath(): string {
    return SeekPreviewController.ffmpegPath;
  }

  getSeekPreviewCacheDir(): string {
    return SeekPreviewController.previewCacheDir;
  }

  setSeekPreviewCacheDir(dir: string): void {
    SeekPreviewController.setSeekPreviewCacheDir(dir);
  }

  clearSeekPreviewCacheDir(): void {
    SeekPreviewController.clearSeekPreviewCacheDir();
  }

  setFfmpegPath(ffmpegPath: string): void {
    SeekPreviewController.setFfmpegPath(ffmpegPath);
    this.host.pushState();
  }

  getFfmpegPath(): string {
    return SeekPreviewController.getFfmpegPath();
  }

  /** 为当前本地媒体离线生成悬停预览雪碧图（需有效 ffmpeg 路径） */
  generateSeekPreviewSprite(): void {
    if (this.host.destroyed) return;
    if (this.seekPreviewGenerating) return;
    if (!isLocalMediaSource(this.host.source)) {
      this.host.emit('seekPreviewError', new Error('Seek preview generation supports local files only'));
      return;
    }
    const ffmpeg = resolveFfmpegExecutable(SeekPreviewController.ffmpegPath);
    if (!ffmpeg || !this.host.source) {
      this.host.emit('seekPreviewError', new Error('No valid ffmpeg path configured'));
      return;
    }

    const source = this.host.source;
    const mediaKey = previewMediaKeyFromSource(source);
    const localPath = resolveLocalPathForFfmpeg(source);
    if (!fs.existsSync(localPath)) {
      this.host.emit('seekPreviewError', new Error(`Local file not found: ${localPath}`));
      return;
    }

    this.cancelSeekPreviewSprite();
    const abort = new AbortController();
    this.seekPreviewAbort = abort;
    SeekPreviewController.seekPreviewActiveAborts.add(abort);
    this.seekPreviewGenerating = true;
    this.seekPreviewPercent = 0;
    this.host.pushState();

    let fallbackDurationMs = 0;
    try {
      fallbackDurationMs = this.host.getLength();
    } catch {
      // ignore
    }

    void runGenerateSeekPreviewSprite({
      cacheRoot: SeekPreviewController.previewCacheDir,
      mediaKey,
      localPath,
      ffmpegPath: ffmpeg,
      fallbackDurationMs,
      signal: abort.signal,
      onProgress: (percent) => {
        if (this.host.destroyed || this.seekPreviewAbort !== abort) return;
        this.seekPreviewPercent = percent;
        this.host.pushState();
      },
    })
      .then(() => {
        if (this.host.destroyed || this.seekPreviewAbort !== abort) return;
        this.seekPreviewGenerating = false;
        this.seekPreviewPercent = 100;
        this.seekPreviewAbort = null;
        this.host.pushState();
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) {
          removeSpriteWorkDir(SeekPreviewController.previewCacheDir, mediaKey);
        }
        if (this.seekPreviewAbort === abort) {
          this.seekPreviewGenerating = false;
          this.seekPreviewPercent = 0;
          this.seekPreviewAbort = null;
        }
        if (!abort.signal.aborted) {
          const message = err instanceof Error ? err.message : String(err);
          this.host.emit('seekPreviewError', new Error(message));
        }
        this.host.pushState();
      })
      .finally(() => {
        SeekPreviewController.seekPreviewActiveAborts.delete(abort);
      });
  }

  /** 取消当前媒体的雪碧图生成（仅删除 `.work/` 半成品，保留已完成雪碧图） */
  cancelSeekPreviewSprite(): void {
    if (this.seekPreviewAbort) {
      this.seekPreviewAbort.abort();
      this.seekPreviewAbort = null;
    }
    this.seekPreviewGenerating = false;
    this.seekPreviewPercent = 0;
    if (this.host.source && isLocalMediaSource(this.host.source)) {
      removeSpriteWorkDir(
        SeekPreviewController.previewCacheDir,
        previewMediaKeyFromSource(this.host.source),
      );
    }
  }

  buildSeekPreviewPushState(): Record<string, unknown> {
    const source = this.host.source;
    const localSource = isLocalMediaSource(source);
    const ffmpegReady = resolveFfmpegExecutable(SeekPreviewController.ffmpegPath) !== null;
    const mediaKey = source ? previewMediaKeyFromSource(source) : '';
    const index =
      localSource && mediaKey
        ? readSpriteIndex(SeekPreviewController.previewCacheDir, mediaKey)
        : null;
    const available = index !== null;

    if (localSource && !ffmpegReady && !SeekPreviewController.ffmpegMissingInfoLogged) {
      SeekPreviewController.ffmpegMissingInfoLogged = true;
      console.info(
        '[electron-vlc-player] ffmpeg path not configured; seek preview unavailable',
      );
    }

    return {
      localSource,
      ffmpegReady,
      canGenerate: localSource && ffmpegReady,
      available,
      generating: this.seekPreviewGenerating,
      percent: this.seekPreviewPercent,
      spriteUrl:
        available && mediaKey
          ? seekPreviewSpriteUrl(SeekPreviewController.previewCacheDir, mediaKey)
          : null,
      intervalMs: index?.intervalMs ?? 0,
      thumbW: index?.thumbW ?? SEEK_PREVIEW_THUMB_W,
      thumbH: index?.thumbH ?? SEEK_PREVIEW_THUMB_H,
      cols: index?.cols ?? 0,
      rows: index?.rows ?? 0,
      count: index?.count ?? 0,
    };
  }
}
