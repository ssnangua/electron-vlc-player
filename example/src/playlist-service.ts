import fs from "node:fs";
import path from "node:path";
import { probeMedia } from "electron-vlc-player";
import type { PlaylistItem } from "./shared/evp-api";
import { isSupportedMediaPath } from "./shared/media-filters";
import { appState, PLAYLIST_PROBE_TIMEOUT_MS } from "./app-state";
import { basename, durationTextFromLengthMs } from "./format";
import { createAndEmbedPlayer, isPlayerReady } from "./player-session";

function probePlaylistItemDurationMs(filePath: string): number {
  const result = probeMedia(filePath, PLAYLIST_PROBE_TIMEOUT_MS);
  return result.length > 0 ? result.length : 0;
}

export function updatePlaylistDuration(
  filePath: string,
  durationText: string,
): void {
  const item = appState.playlist.find((entry) => entry.path === filePath);
  if (!item || item.durationText === durationText) return;
  item.durationText = durationText;
  pushPlaylist();
}

export function schedulePlaylistDurationProbes(paths: string[]): void {
  for (const filePath of paths) {
    const item = appState.playlist.find((entry) => entry.path === filePath);
    if (!item || item.durationText) continue;
    appState.pendingPlaylistDurationProbePaths.add(filePath);
  }
  void runPlaylistDurationProbeQueue();
}

async function runPlaylistDurationProbeQueue(): Promise<void> {
  if (appState.playlistDurationProbeRunning) return;
  if (!isPlayerReady()) return;
  if (appState.pendingPlaylistDurationProbePaths.size === 0) return;

  appState.playlistDurationProbeRunning = true;
  try {
    while (appState.pendingPlaylistDurationProbePaths.size > 0) {
      const filePath = appState.pendingPlaylistDurationProbePaths
        .values()
        .next().value;
      if (!filePath) break;
      appState.pendingPlaylistDurationProbePaths.delete(filePath);

      const item = appState.playlist.find((entry) => entry.path === filePath);
      if (!item || item.durationText) continue;

      await new Promise<void>((resolve) => {
        setImmediate(() => resolve());
      });

      try {
        const ms = probePlaylistItemDurationMs(filePath);
        if (ms > 0) {
          updatePlaylistDuration(filePath, durationTextFromLengthMs(ms));
        }
      } catch (err) {
        console.warn("[example] probe playlist duration failed:", filePath, err);
      }
    }
  } finally {
    appState.playlistDurationProbeRunning = false;
    if (
      appState.pendingPlaylistDurationProbePaths.size > 0 &&
      isPlayerReady()
    ) {
      void runPlaylistDurationProbeQueue();
    }
  }
}

export function syncPlayerPlaylist(): void {
  if (!appState.player?.isEmbedded()) return;
  appState.player.setPlaylist(appState.playlist.map((item) => item.path));
}

export function pushPlaylist(): void {
  appState.mainWindow?.webContents.send("evp:playlist", {
    playlist: appState.playlist,
    currentPath: appState.currentPath,
  });
  syncPlayerPlaylist();
}

export function addToPlaylist(filePaths: string[]): void {
  const added: string[] = [];
  for (const filePath of filePaths) {
    if (!filePath || appState.playlist.some((p) => p.path === filePath)) continue;
    appState.playlist.push({ path: filePath, title: basename(filePath) });
    added.push(filePath);
  }
  if (added.length) {
    pushPlaylist();
    schedulePlaylistDurationProbes(added);
  }
}

function normalizeDroppedPaths(rawPaths: string[]): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const raw of rawPaths) {
    if (!raw) continue;
    const filePath = path.normalize(raw);
    if (seen.has(filePath)) continue;
    try {
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
    } catch {
      continue;
    }
    if (!isSupportedMediaPath(filePath)) continue;
    seen.add(filePath);
    paths.push(filePath);
  }
  return paths;
}

export async function handleDroppedMedia(rawPaths: string[]): Promise<void> {
  const paths = normalizeDroppedPaths(rawPaths);
  if (!paths.length) return;
  addToPlaylist(paths);
  if (!appState.vlcDir.trim()) return;
  try {
    await createAndEmbedPlayer();
  } catch (err) {
    console.error("[example] drop media failed:", err);
  }
}

export function removeFromPlaylist(filePath: string): boolean {
  const index = appState.playlist.findIndex((p) => p.path === filePath);
  if (index < 0) return false;

  const wasCurrent = appState.currentPath === filePath;
  appState.playlist.splice(index, 1);
  appState.pendingPlaylistDurationProbePaths.delete(filePath);

  if (wasCurrent) {
    const nextPath =
      appState.playlist.length > 0
        ? appState.playlist[Math.min(index, appState.playlist.length - 1)]!.path
        : null;
    appState.currentPath = nextPath;
    const p = appState.player;
    if (nextPath && p?.isEmbedded()) {
      p.setSource(nextPath);
      p.notifyLayoutChange();
    } else if (p?.isEmbedded()) {
      p.unloadMedia();
    }
  }

  pushPlaylist();
  return wasCurrent;
}

export function clearPlaylist(): void {
  appState.playlist = [];
  appState.currentPath = null;
  appState.pendingPlaylistDurationProbePaths.clear();
  const p = appState.player;
  if (p?.isEmbedded()) {
    p.unloadMedia();
  }
  pushPlaylist();
}

export function restorePlaylist(
  items: PlaylistItem[],
  savedCurrentPath: string | null,
): void {
  appState.playlist = items.filter(
    (item) => item.path && fs.existsSync(item.path),
  );
  appState.currentPath =
    savedCurrentPath &&
    appState.playlist.some((p) => p.path === savedCurrentPath)
      ? savedCurrentPath
      : null;
  pushPlaylist();
  schedulePlaylistDurationProbes(appState.playlist.map((item) => item.path));
}
