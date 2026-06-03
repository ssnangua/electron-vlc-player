import type { BrowserWindow } from "electron";
import type { VlcPlaybackMode, VlcPlayer, VlcPlayerLocale } from "electron-vlc-player";
import {
  probeDefaultFfmpegPath,
  probeDefaultVlcDir,
  resolvePlayerLocale,
} from "electron-vlc-player";
import type { MediaInfoView, PlaylistItem } from "./shared/evp-api";

export const APP_TITLE = "Electron VLC Player";
export const PLAYLIST_PROBE_TIMEOUT_MS = 15_000;

export const appState = {
  mainWindow: null as BrowserWindow | null,
  player: null as VlcPlayer | null,
  playerReady: null as Promise<void> | null,
  vlcDir: probeDefaultVlcDir() ?? "",
  ffmpegPath: probeDefaultFfmpegPath() ?? "",
  playbackMode: "default" as VlcPlaybackMode,
  playlist: [] as PlaylistItem[],
  currentPath: null as string | null,
  cachedMediaInfo: { path: null } as MediaInfoView,
  pendingMediaParseOnPlaying: null as (() => void) | null,
  pendingPlaylistDurationProbePaths: new Set<string>(),
  playlistDurationProbeRunning: false,
  locale: resolvePlayerLocale() as VlcPlayerLocale,
};
