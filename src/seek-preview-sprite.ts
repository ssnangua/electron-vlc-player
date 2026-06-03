import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawn, type ChildProcess } from 'node:child_process';

export const SEEK_PREVIEW_THUMB_W = 160;
export const SEEK_PREVIEW_THUMB_H = 90;
export const SEEK_PREVIEW_MAX_FRAMES = 300;
export const SEEK_PREVIEW_MIN_INTERVAL_MS = 2000;
export const SEEK_PREVIEW_SPRITE_COLS = 10;

export interface SeekPreviewSpriteIndex {
  version: 1;
  intervalMs: number;
  thumbW: number;
  thumbH: number;
  cols: number;
  rows: number;
  count: number;
  durationMs: number;
}

export interface SeekPreviewGenerateOptions {
  cacheRoot: string;
  mediaKey: string;
  localPath: string;
  ffmpegPath: string;
  /** libVLC getLength 等 fallback，ffmpeg 解析失败时使用 */
  fallbackDurationMs?: number;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

const REMOTE_SOURCE_RE =
  /^(?:https?|rtsp|rtsps|rtmp|rtmps|mms|mmsh|mmst|udp|tcp|srt|ftp|sftp):\/\//i;

export function isLocalMediaSource(src: string | null | undefined): boolean {
  if (!src?.trim()) return false;
  const trimmed = src.trim();
  if (REMOTE_SOURCE_RE.test(trimmed)) return false;
  return true;
}

export function resolveLocalPathForFfmpeg(src: string): string {
  const trimmed = src.trim();
  if (/^file:\/\//i.test(trimmed)) {
    let p = trimmed.replace(/^file:\/\//i, '');
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
    try {
      p = decodeURIComponent(p);
    } catch {
      // keep raw
    }
    return path.normalize(p);
  }
  return path.normalize(trimmed);
}

export function resolveFfmpegExecutable(rawPath: string | null | undefined): string | null {
  const trimmed = rawPath?.trim();
  if (!trimmed) return null;
  try {
    const stat = fs.statSync(trimmed);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }
  return path.resolve(trimmed);
}

export function previewMediaKeyFromSource(src: string): string {
  let base = '';
  try {
    if (/^https?:\/\//i.test(src)) {
      const u = new URL(src);
      base = path.basename(decodeURIComponent(u.pathname)) || u.hostname;
    } else if (/^file:\/\//i.test(src)) {
      base = path.basename(resolveLocalPathForFfmpeg(src));
    } else {
      base = path.basename(src);
    }
  } catch {
    base = path.basename(src);
  }
  const stem = base.replace(/\.[^.]+$/, '') || base || 'media';
  const safe = stem
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '');
  return (safe.slice(0, 120) || 'media').toLowerCase();
}

export function mediaSpriteDir(cacheRoot: string, mediaKey: string): string {
  return path.join(cacheRoot, mediaKey);
}

export function spriteIndexPath(cacheRoot: string, mediaKey: string): string {
  return path.join(mediaSpriteDir(cacheRoot, mediaKey), 'index.json');
}

export function spriteImagePath(cacheRoot: string, mediaKey: string): string {
  return path.join(mediaSpriteDir(cacheRoot, mediaKey), 'sprite.jpg');
}

export function spriteWorkDir(cacheRoot: string, mediaKey: string): string {
  return path.join(mediaSpriteDir(cacheRoot, mediaKey), '.work');
}

export function readSpriteIndex(
  cacheRoot: string,
  mediaKey: string,
): SeekPreviewSpriteIndex | null {
  try {
    const raw = fs.readFileSync(spriteIndexPath(cacheRoot, mediaKey), 'utf8');
    const data = JSON.parse(raw) as SeekPreviewSpriteIndex;
    if (data.version !== 1) return null;
    if (
      !Number.isFinite(data.intervalMs) ||
      !Number.isFinite(data.count) ||
      data.count <= 0 ||
      !Number.isFinite(data.cols) ||
      !Number.isFinite(data.rows)
    ) {
      return null;
    }
    const sprite = spriteImagePath(cacheRoot, mediaKey);
    if (!fs.existsSync(sprite)) return null;
    const stat = fs.statSync(sprite);
    if (stat.size < 512) return null;
    return data;
  } catch {
    return null;
  }
}

export function isSpriteAvailable(cacheRoot: string, mediaKey: string): boolean {
  return readSpriteIndex(cacheRoot, mediaKey) !== null;
}

export function computeAdaptiveIntervalMs(durationMs: number): number {
  const d = Math.max(0, Math.floor(durationMs));
  if (d <= 0) return SEEK_PREVIEW_MIN_INTERVAL_MS;
  const secBucket = Math.ceil(d / SEEK_PREVIEW_MAX_FRAMES / 1000);
  return Math.max(SEEK_PREVIEW_MIN_INTERVAL_MS, secBucket * 1000);
}

export function computeFramePlan(durationMs: number): {
  intervalMs: number;
  count: number;
  cols: number;
  rows: number;
} {
  const duration = Math.max(0, Math.floor(durationMs));
  const intervalMs = computeAdaptiveIntervalMs(duration);
  let count =
    duration > 0 ? Math.floor(duration / intervalMs) + 1 : 1;
  count = Math.max(1, Math.min(SEEK_PREVIEW_MAX_FRAMES, count));
  const cols = SEEK_PREVIEW_SPRITE_COLS;
  const rows = Math.max(1, Math.ceil(count / cols));
  return { intervalMs, count, cols, rows };
}

function parseDurationMsFromFfmpeg(text: string): number | null {
  const m = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || !Number.isFinite(sec)) return null;
  return Math.max(0, Math.floor((h * 3600 + min * 60 + sec) * 1000));
}

function rmDirRecursive(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export function removeSpriteWorkDir(cacheRoot: string, mediaKey: string): void {
  rmDirRecursive(spriteWorkDir(cacheRoot, mediaKey));
}

function waitAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    signal.addEventListener(
      'abort',
      () => reject(new DOMException('Aborted', 'AbortError')),
      { once: true },
    );
  });
}

function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  signal: AbortSignal | undefined,
  onStderr?: (chunk: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let proc: ChildProcess | null = null;
    const abortHandler = (): void => {
      if (proc?.pid) {
        try {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t']);
          } else {
            proc.kill('SIGKILL');
          }
        } catch {
          // ignore
        }
      }
      reject(new DOMException('Aborted', 'AbortError'));
    };

    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    signal?.addEventListener('abort', abortHandler, { once: true });

    proc = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    const stderr = proc.stderr;
    if (!stderr) {
      signal?.removeEventListener('abort', abortHandler);
      reject(new Error('ffmpeg stderr unavailable'));
      return;
    }

    stderr.setEncoding('utf8');
    stderr.on('data', (chunk: string) => {
      onStderr?.(chunk);
    });

    proc.on('error', (err) => {
      signal?.removeEventListener('abort', abortHandler);
      reject(err);
    });

    proc.on('close', (code) => {
      signal?.removeEventListener('abort', abortHandler);
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code ?? 'unknown'}`));
    });
  });
}

function parseTimeMsFromFfmpegText(text: string): number | null {
  let bestMs: number | null = null;
  for (const m of text.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    const sec = Number(m[3]);
    if (!Number.isFinite(h) || !Number.isFinite(min) || !Number.isFinite(sec)) continue;
    bestMs = Math.max(0, Math.floor((h * 3600 + min * 60 + sec) * 1000));
  }
  return bestMs;
}

function parseOutTimeUsFromProgressText(text: string): number | null {
  let bestUs: number | null = null;
  for (const m of text.matchAll(/out_time_us=(\d+)/g)) {
    const us = Number(m[1]);
    if (Number.isFinite(us) && us >= 0) bestUs = us;
  }
  return bestUs;
}

function countShowinfoFramesInText(text: string): number {
  return (text.match(/pts_time:/g) ?? []).length;
}

class SpriteGenerateProgress {
  private lastReported: number;
  private readonly stderrBuf = { value: '' };
  private readonly showinfoFrames = { value: 0 };
  private readonly startMs = Date.now();
  readonly progressPath: string;

  constructor(
    private readonly durationMs: number,
    private readonly targetFrames: number,
    private readonly useHwaccel: boolean,
    private readonly onProgress: ((percent: number) => void) | undefined,
    private readonly rangeStart: number,
    private readonly rangeEnd: number,
  ) {
    this.lastReported = rangeStart;
    this.progressPath = path.join(
      os.tmpdir(),
      `evp-ffprogress-${process.pid}-${Date.now()}.txt`,
    );
  }

  cleanup(): void {
    try {
      if (fs.existsSync(this.progressPath)) fs.unlinkSync(this.progressPath);
    } catch {
      // ignore
    }
  }

  onStderrChunk(chunk: string): void {
    this.stderrBuf.value += chunk;
    const parts = this.stderrBuf.value.split(/\r|\n/);
    this.stderrBuf.value = parts.pop() ?? '';
    const joined = parts.join('\n');
    if (!joined) return;

    this.showinfoFrames.value += countShowinfoFramesInText(joined);
    this.reportFromMetrics({
      timeMs: parseTimeMsFromFfmpegText(joined),
      showinfoFrames: this.showinfoFrames.value,
    });
  }

  pollProgressFile(): void {
    if (!fs.existsSync(this.progressPath)) return;
    let text = '';
    try {
      text = fs.readFileSync(this.progressPath, 'utf8');
    } catch {
      return;
    }
    const outTimeUs = parseOutTimeUsFromProgressText(text);
    const timeMs = outTimeUs != null ? Math.floor(outTimeUs / 1000) : null;
    this.reportFromMetrics({ timeMs, showinfoFrames: this.showinfoFrames.value });
  }

  tickEstimate(): void {
    if (this.durationMs <= 0) return;
    const speedFactor = this.useHwaccel ? 2.5 : 0.75;
    const estimatedTotalMs = Math.max(3000, this.durationMs / speedFactor);
    const elapsedMs = Date.now() - this.startMs;
    const ratio = Math.min(0.93, elapsedMs / estimatedTotalMs);
    const pct = Math.floor(this.rangeStart + ratio * (this.rangeEnd - this.rangeStart));
    this.emit(pct);
  }

  private reportFromMetrics(metrics: {
    timeMs: number | null;
    showinfoFrames: number;
  }): void {
    const candidates: number[] = [];

    if (metrics.timeMs != null && this.durationMs > 0) {
      const ratio = Math.min(1, metrics.timeMs / this.durationMs);
      candidates.push(
        Math.floor(this.rangeStart + ratio * (this.rangeEnd - this.rangeStart)),
      );
    }

    if (metrics.showinfoFrames > 0 && this.targetFrames > 0) {
      const ratio = Math.min(1, metrics.showinfoFrames / this.targetFrames);
      candidates.push(
        Math.floor(this.rangeStart + ratio * (this.rangeEnd - this.rangeStart)),
      );
    }

    if (candidates.length === 0) return;
    this.emit(Math.max(...candidates));
  }

  private emit(pct: number): void {
    if (!this.onProgress) return;
    const clamped = Math.max(this.rangeStart, Math.min(this.rangeEnd, pct));
    if (clamped <= this.lastReported) return;
    this.lastReported = clamped;
    this.onProgress(clamped);
  }
}

function buildSpriteVideoFilter(plan: {
  intervalMs: number;
  cols: number;
  rows: number;
}): string {
  const intervalSec = plan.intervalMs / 1000;
  return [
    `fps=1/${intervalSec}`,
    `scale=${SEEK_PREVIEW_THUMB_W}:${SEEK_PREVIEW_THUMB_H}:force_original_aspect_ratio=decrease`,
    `pad=${SEEK_PREVIEW_THUMB_W}:${SEEK_PREVIEW_THUMB_H}:(ow-iw)/2:(oh-ih)/2:black`,
    'showinfo',
    `tile=${plan.cols}x${plan.rows}`,
  ].join(',');
}

function buildSinglePassSpriteArgs(
  localPath: string,
  spritePath: string,
  progressPath: string,
  plan: { intervalMs: number; cols: number; rows: number },
  useHwaccel: boolean,
): string[] {
  const args = ['-hide_banner', '-y', '-stats_period', '0.5'];
  if (useHwaccel) {
    args.push('-hwaccel', 'auto');
  }
  args.push(
    '-progress',
    progressPath,
    '-i',
    localPath,
    '-an',
    '-sn',
    '-dn',
    '-vf',
    buildSpriteVideoFilter(plan),
    '-frames:v',
    '1',
    '-q:v',
    '3',
    spritePath,
  );
  return args;
}

function removePartialSprite(spritePath: string): void {
  try {
    if (fs.existsSync(spritePath)) fs.unlinkSync(spritePath);
  } catch {
    // ignore
  }
}

async function generateSpriteSinglePass(
  ffmpegPath: string,
  localPath: string,
  spritePath: string,
  plan: { intervalMs: number; cols: number; rows: number; count: number },
  durationMs: number,
  signal: AbortSignal | undefined,
  onProgress: ((percent: number) => void) | undefined,
): Promise<void> {
  const runOnce = async (useHwaccel: boolean): Promise<void> => {
    removePartialSprite(spritePath);
    const tracker = new SpriteGenerateProgress(
      durationMs,
      plan.count,
      useHwaccel,
      onProgress,
      5,
      98,
    );
    const pollTimer = setInterval(() => {
      tracker.pollProgressFile();
      tracker.tickEstimate();
    }, 400);
    try {
      await runFfmpeg(
        ffmpegPath,
        buildSinglePassSpriteArgs(
          localPath,
          spritePath,
          tracker.progressPath,
          plan,
          useHwaccel,
        ),
        signal,
        (chunk) => tracker.onStderrChunk(chunk),
      );
    } finally {
      clearInterval(pollTimer);
      tracker.cleanup();
    }
  };

  try {
    await runOnce(true);
  } catch (err) {
    if (signal?.aborted) throw err;
    await runOnce(false);
  }
}

async function probeDurationMs(
  ffmpegPath: string,
  localPath: string,
  fallbackDurationMs: number | undefined,
  signal: AbortSignal | undefined,
): Promise<number> {
  let stderr = '';
  await Promise.race([
    runFfmpeg(
      ffmpegPath,
      ['-hide_banner', '-i', localPath],
      signal,
      (chunk) => {
        stderr += chunk;
      },
    ).catch(() => undefined),
    waitAbort(signal),
  ]).catch((err) => {
    throw err;
  });

  const parsed = parseDurationMsFromFfmpeg(stderr);
  if (parsed != null && parsed > 0) return parsed;
  if (fallbackDurationMs != null && fallbackDurationMs > 0) return fallbackDurationMs;
  throw new Error('无法解析视频时长（ffmpeg Duration 与 fallback 均无效）');
}

export async function runGenerateSeekPreviewSprite(
  options: SeekPreviewGenerateOptions,
): Promise<SeekPreviewSpriteIndex> {
  const {
    cacheRoot,
    mediaKey,
    localPath,
    ffmpegPath,
    fallbackDurationMs,
    onProgress,
    signal,
  } = options;

  const mediaDir = mediaSpriteDir(cacheRoot, mediaKey);
  const spritePath = spriteImagePath(cacheRoot, mediaKey);
  const indexPath = spriteIndexPath(cacheRoot, mediaKey);

  fs.mkdirSync(cacheRoot, { recursive: true });
  fs.mkdirSync(mediaDir, { recursive: true });
  rmDirRecursive(spriteWorkDir(cacheRoot, mediaKey));
  removePartialSprite(spritePath);

  onProgress?.(1);

  const durationMs = await probeDurationMs(
    ffmpegPath,
    localPath,
    fallbackDurationMs,
    signal,
  );
  const plan = computeFramePlan(durationMs);

  onProgress?.(5);

  await Promise.race([
    generateSpriteSinglePass(
      ffmpegPath,
      localPath,
      spritePath,
      plan,
      durationMs,
      signal,
      onProgress,
    ),
    waitAbort(signal),
  ]);

  if (!fs.existsSync(spritePath) || fs.statSync(spritePath).size < 512) {
    throw new Error('ffmpeg 未生成有效雪碧图');
  }

  onProgress?.(99);

  const index: SeekPreviewSpriteIndex = {
    version: 1,
    intervalMs: plan.intervalMs,
    thumbW: SEEK_PREVIEW_THUMB_W,
    thumbH: SEEK_PREVIEW_THUMB_H,
    cols: plan.cols,
    rows: plan.rows,
    count: plan.count,
    durationMs,
  };

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
  onProgress?.(100);
  return index;
}

export function clearSeekPreviewCacheRoot(cacheRoot: string): void {
  rmDirRecursive(cacheRoot);
  fs.mkdirSync(cacheRoot, { recursive: true });
}

/**
 * Windows：从注册表读取用户/系统 PATH（UTF-8）。
 * 避免 process.env.Path 在含中文目录时出现乱码导致 existsSync 失败。
 */
function readWindowsUnicodePathEnv(): string | null {
  if (process.platform !== 'win32') return null;
  const outFile = path.join(os.tmpdir(), `evp-path-${process.pid}.txt`);
  try {
    const ps = [
      "$p = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')",
      `[IO.File]::WriteAllText('${outFile.replace(/\\/g, '\\\\')}', $p, [Text.UTF8Encoding]::new($false))`,
    ].join('; ');
    execSync(`powershell -NoProfile -Command "${ps}"`, {
      stdio: 'ignore',
      windowsHide: true,
    });
    const raw = fs.readFileSync(outFile, 'utf8');
    return raw;
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(outFile);
    } catch {
      // ignore
    }
  }
}

function resolvePathEnvForProbe(): string {
  if (process.platform === 'win32') {
    const fromRegistry = readWindowsUnicodePathEnv();
    if (fromRegistry) return fromRegistry;
  }
  return process.env.PATH ?? process.env.Path ?? '';
}

function ffmpegCandidatesFromPathEnv(): string[] {
  const pathEnv = resolvePathEnvForProbe();
  const sep = process.platform === 'win32' ? ';' : ':';
  const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const out: string[] = [];
  for (const dir of pathEnv.split(sep)) {
    const trimmed = dir.trim();
    if (!trimmed) continue;
    out.push(path.join(trimmed, exeName));
  }
  return out;
}

function probeFfmpegViaWhereExe(): string | null {
  if (process.platform !== 'win32') return null;
  try {
    const out = execSync('where.exe ffmpeg', {
      encoding: 'utf8',
      windowsHide: true,
    });
    const first = out.trim().split(/\r?\n/)[0]?.trim();
    if (!first) return null;
    return resolveFfmpegExecutable(first);
  } catch {
    return null;
  }
}

/** 可选探测：常见安装路径 + 系统 PATH 中的 ffmpeg。库本身不会调用；集成方自行调用后传入 `vlcDir` 同级的 `ffmpegPath` 或 {@link VlcPlayer.setFfmpegPath}。 */
export function probeDefaultFfmpegPath(): string | null {
  const seen = new Set<string>();
  const candidates: string[] = [];

  const add = (p: string): void => {
    const resolved = path.resolve(p);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    candidates.push(resolved);
  };

  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
    const programFilesX86 =
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    add(path.join(programFiles, 'ffmpeg', 'bin', 'ffmpeg.exe'));
    add(path.join(programFiles, 'VideoLAN', 'VLC', 'ffmpeg.exe'));
    add(path.join(programFilesX86, 'VideoLAN', 'VLC', 'ffmpeg.exe'));
  } else {
    add('/usr/bin/ffmpeg');
    add('/usr/local/bin/ffmpeg');
    add('/opt/homebrew/bin/ffmpeg');
  }

  for (const p of ffmpegCandidatesFromPathEnv()) {
    add(p);
  }

  for (const c of candidates) {
    const ok = resolveFfmpegExecutable(c);
    if (ok) return ok;
  }

  if (process.platform === 'win32') {
    return probeFfmpegViaWhereExe();
  }
  return null;
}
