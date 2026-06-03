import type { MediaParsedResult, MediaStreamInfo } from "electron-vlc-player";
import type { MediaInfoView, MediaStreamView } from "./shared/evp-api";
import { appState } from "./app-state";
import { basename, durationTextFromLengthMs } from "./format";
import {
  isPlayerReady,
  requirePlayer,
  updateWindowTitle,
} from "./player-session";
import { updatePlaylistDuration } from "./playlist-service";

function streamLabel(type: MediaStreamInfo["type"]): string {
  switch (type) {
    case "video":
      return "视频";
    case "audio":
      return "音频";
    case "subtitle":
      return "字幕";
    default:
      return "未知";
  }
}

function streamViewsFromTracks(tracks: MediaStreamInfo[]): MediaStreamView[] {
  const real = tracks.filter((t) => t.id >= 0);
  return real.map((stream, index) => {
    const parts: string[] = [];
    const desc = stream.description?.trim();
    const codec = stream.codec?.trim();
    if (codec && codec !== desc) parts.push(codec);
    if (stream.language) parts.push(stream.language);
    if (desc) parts.push(desc);
    if (stream.type === "video" && stream.width && stream.height) {
      parts.push(`${stream.width}×${stream.height}`);
    }
    if (stream.type === "audio" && stream.sampleRate) {
      parts.push(`${stream.sampleRate} Hz`);
      if (stream.channels) parts.push(`${stream.channels} ch`);
    }
    return {
      type: `流 ${index}`,
      codec: streamLabel(stream.type),
      language: stream.language,
      description: stream.description,
      details: parts.length ? parts.join(" · ") : undefined,
    };
  });
}

function resolutionFromTracks(tracks: MediaStreamInfo[]): string | undefined {
  const videos = tracks.filter(
    (t) => t.type === "video" && t.width && t.height,
  );
  if (!videos.length) return undefined;
  const best = videos.reduce((a, b) =>
    (a.width ?? 0) * (a.height ?? 0) >= (b.width ?? 0) * (b.height ?? 0)
      ? a
      : b,
  );
  return `${best.width} × ${best.height}`;
}

function fpsFromTracks(tracks: MediaStreamInfo[]): number | undefined {
  const video = tracks.find(
    (t) => t.type === "video" && t.frameRate && t.frameRate > 0,
  );
  return video?.frameRate;
}

export function mediaDisplayTitle(filePath: string): string {
  const filename = basename(filePath);
  if (!isPlayerReady()) return filename;
  try {
    const metaTitle = requirePlayer()
      .getMediaMetadataResult()
      .data.title?.trim();
    if (metaTitle) return metaTitle;
  } catch {
    // 尚未加载媒体或 metadata 不可读
  }
  return filename;
}

export function buildMediaInfoView(
  filePath: string | null,
  parsed?: MediaParsedResult,
): MediaInfoView {
  if (!filePath || !isPlayerReady()) {
    return { path: null };
  }
  const filename = basename(filePath);
  if (!parsed) {
    return {
      path: filePath,
      title: filename,
      filename,
      durationText: "解析中…",
    };
  }

  const p = requirePlayer();
  const meta = parsed.metadata;
  const displayTitle = meta.title?.trim() || filename;
  const resolution =
    resolutionFromTracks(parsed.tracks) ??
    (() => {
      try {
        const size = p.getVideoSize();
        if (size.width > 0 && size.height > 0)
          return `${size.width} × ${size.height}`;
      } catch {
        // ignore
      }
      return undefined;
    })();

  let fps = fpsFromTracks(parsed.tracks);
  if (fps == null || fps <= 0) {
    try {
      const live = p.getFps();
      if (live > 0) fps = live;
    } catch {
      // ignore
    }
  }

  const lengthMs = parsed.length > 0 ? parsed.length : p.getLength();
  return {
    path: filePath,
    title: displayTitle,
    filename,
    artist: meta.artist,
    album: meta.album,
    genre: meta.genre,
    durationText: durationTextFromLengthMs(lengthMs),
    resolution: resolution ?? "—",
    fps,
    streams: parsed.tracks.length
      ? streamViewsFromTracks(parsed.tracks)
      : undefined,
    notice: parsed.tracksNotice,
  };
}

/** 解码出画面后刷新分辨率/帧率（getVideoSize 在首帧前可能为 0） */
function scheduleLiveDisplayMetricsRefresh(filePath: string): void {
  const delays = [400, 1200, 2500];
  for (const ms of delays) {
    setTimeout(() => {
      if (appState.currentPath !== filePath || !appState.player) return;
      const base = appState.cachedMediaInfo;
      if (!base.path || base.path !== filePath) return;
      let resolution = base.resolution;
      let fps = base.fps;
      try {
        const size = appState.player.getVideoSize();
        if (size.width > 0 && size.height > 0) {
          resolution = `${size.width} × ${size.height}`;
        }
      } catch {
        // ignore
      }
      try {
        const live = appState.player.getFps();
        if (live > 0) fps = live;
      } catch {
        // ignore
      }
      if (resolution === base.resolution && fps === base.fps) return;
      pushMediaInfo({ ...base, resolution: resolution ?? "—", fps });
    }, ms);
  }
}

export function pushMediaInfo(view?: MediaInfoView): void {
  const info = view ?? buildMediaInfoView(appState.currentPath);
  if (info.path && info.durationText !== "解析中…") {
    appState.cachedMediaInfo = info;
  }
  appState.mainWindow?.webContents.send("evp:media-info", info);
}

/** 等进入播放（或已暂停）后再 parse，避免 Opening 黑屏阶段读轨导致 native 崩溃 */
export function scheduleMediaParse(filePath: string): void {
  const { player } = appState;
  if (!player) return;
  pushMediaInfo(buildMediaInfoView(filePath));

  if (appState.pendingMediaParseOnPlaying) {
    player.off("playing", appState.pendingMediaParseOnPlaying);
    appState.pendingMediaParseOnPlaying = null;
  }

  let started = false;
  const runParse = (): void => {
    appState.pendingMediaParseOnPlaying = null;
    if (started || appState.currentPath !== filePath || !appState.player) return;
    started = true;
    void appState.player
      .parseMedia()
      .then((parsed) => {
        if (appState.currentPath !== filePath) return;
        updateWindowTitle(filePath);
        const info = buildMediaInfoView(filePath, parsed);
        if (info.durationText) {
          updatePlaylistDuration(filePath, info.durationText);
        }
        pushMediaInfo(info);
        scheduleLiveDisplayMetricsRefresh(filePath);
      })
      .catch((err) => {
        if (appState.currentPath !== filePath) return;
        console.error("[example] parse media failed:", err);
        pushMediaInfo({
          path: filePath,
          title: basename(filePath),
          filename: basename(filePath),
          durationText: "解析失败",
        });
      });
  };

  appState.pendingMediaParseOnPlaying = runParse;
  player.once("playing", runParse);
}
