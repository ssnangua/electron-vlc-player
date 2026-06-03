import {
  VlcPlayer,
  resolveVlcDir,
  probeDefaultFfmpegPath,
} from "electron-vlc-player";
import type { VlcPlaylistItemChangedPayload } from "electron-vlc-player";
import { APP_TITLE, appState } from "./app-state";
import { getExampleUiStrings } from "./shared/example-i18n";
import {
  buildMediaInfoView,
  mediaDisplayTitle,
  pushMediaInfo,
  scheduleMediaParse,
} from "./media-info";
import {
  addToPlaylist,
  pushPlaylist,
  schedulePlaylistDurationProbes,
  syncPlayerPlaylist,
} from "./playlist-service";

export function isPlayerReady(): boolean {
  return appState.player?.isEmbedded() ?? false;
}

export function requirePlayer(): VlcPlayer {
  const p = appState.player;
  if (!p?.isEmbedded()) {
    throw new Error(getExampleUiStrings(appState.locale).errorPlayerNotReady);
  }
  return p;
}

export function updateWindowTitle(filePath: string | null): void {
  const { mainWindow } = appState;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!filePath) {
    mainWindow.setTitle(APP_TITLE);
    return;
  }
  mainWindow.setTitle(`${mediaDisplayTitle(filePath)} - ${APP_TITLE}`);
}

export function destroyPlayer(): void {
  if (appState.player) {
    appState.player.destroy();
    appState.player = null;
  }
  appState.playerReady = null;
  appState.cachedMediaInfo = { path: null };
  updateWindowTitle(null);
}

/** 创建并 embed；并发调用会等待同一次 embed，不会互相 destroy */
export async function createAndEmbedPlayer(): Promise<void> {
  if (!appState.mainWindow) return;
  const trimmed = appState.vlcDir.trim();
  if (!trimmed) {
    throw new Error(getExampleUiStrings(appState.locale).errorVlcDirNotSet);
  }
  if (!appState.playerReady) {
    appState.playerReady = (async () => {
      destroyPlayer();
      const resolved = resolveVlcDir(trimmed);
      appState.vlcDir = resolved;
      const ffmpegPath = appState.ffmpegPath.trim() || probeDefaultFfmpegPath();
      appState.player = new VlcPlayer({
        window: appState.mainWindow!,
        container: "#stage",
        vlcDir: resolved,
        controls: true,
        playbackMode: appState.playbackMode,
        locale: appState.locale,
        ...(ffmpegPath ? { ffmpegPath } : {}),
      });
      if (ffmpegPath) {
        appState.ffmpegPath = ffmpegPath;
        console.info(`[example] ffmpeg configured: ${ffmpegPath}`);
      } else {
        console.info(
          "[example] ffmpeg not found; pass ffmpegPath to VlcPlayer or call setFfmpegPath(...) to enable seek preview",
        );
      }
      await appState.player.embed();
      appState.player.on("playlistItemChanged", (payload: unknown) => {
        const { src } = payload as VlcPlaylistItemChangedPayload;
        appState.currentPath = src;
        addToPlaylist([src]);
        updateWindowTitle(src);
        pushPlaylist();
        scheduleMediaParse(src);
      });
      syncPlayerPlaylist();
      schedulePlaylistDurationProbes(
        appState.playlist.map((item) => item.path),
      );
    })().catch((err) => {
      appState.playerReady = null;
      throw err;
    });
  }
  await appState.playerReady;
}

/** 换 libVLC 目录：必须销毁后重新 embed */
export async function recreatePlayer(): Promise<void> {
  destroyPlayer();
  await createAndEmbedPlayer();
}

export function restoreOverlayFocus(p: VlcPlayer | null): void {
  if (!p?.isEmbedded()) return;
  p.showOverlay();
  p.focusOverlay();
}

export function playPath(filePath: string): void {
  const p = requirePlayer();
  appState.currentPath = filePath;
  addToPlaylist([filePath]);
  p.setSource(filePath);
  p.notifyLayoutChange();
  updateWindowTitle(filePath);
  scheduleMediaParse(filePath);
  p.focusOverlay();
}
