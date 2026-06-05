import { BrowserWindow, dialog, ipcMain, Menu } from "electron";
import type { WebContents } from "electron";
import { resolveVlcDir, getLibVlcVersion } from "electron-vlc-player";
import type { PlaylistItem } from "./shared/evp-api";
import { buildLocaleView, getExampleUiStrings } from "./shared/example-i18n";
import {
  formatErrorInvalidFfmpegPath,
  formatErrorInvalidPlaybackMode,
  formatHintLibvlcLoaded,
} from "./shared/media-query-i18n";
import { buildMediaFileFilters } from "./shared/media-filters";
import { appState } from "./app-state";
import { basename } from "./format";
import {
  buildMediaInfoView,
  pushMediaInfo,
  scheduleMediaParse,
} from "./media-info";
import {
  addToPlaylist,
  clearPlaylist,
  handleDroppedMedia,
  pushPlaylist,
  removeFromPlaylist,
  restorePlaylist,
} from "./playlist-service";
import {
  createAndEmbedPlayer,
  playPath,
  recreatePlayer,
  requirePlayer,
  restoreOverlayFocus,
  updateWindowTitle,
} from "./player-session";
import { resolveFfmpegExecutable } from "electron-vlc-player";

const FILE_DRAG_OVER_CLEAR_JS =
  "document.body.classList.remove('file-drag-over')";
const FILE_DRAG_OVER_SET_JS =
  "document.body.classList.add('file-drag-over')";

function isAppWebContents(contents: WebContents): boolean {
  const { mainWindow } = appState;
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (contents === mainWindow.webContents) return true;
  const win = BrowserWindow.fromWebContents(contents);
  if (!win || win.isDestroyed()) return false;
  return win === mainWindow || win.getParentWindow() === mainWindow;
}

function syncFileDragOverState(
  screenX: number,
  screenY: number,
  fileDrag: boolean,
): void {
  const { mainWindow } = appState;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
  const bounds = mainWindow.getBounds();
  const inside =
    screenX >= bounds.x &&
    screenX < bounds.x + bounds.width &&
    screenY >= bounds.y &&
    screenY < bounds.y + bounds.height;
  if (inside && fileDrag) {
    void mainWindow.webContents.executeJavaScript(FILE_DRAG_OVER_SET_JS);
  } else if (!inside) {
    void mainWindow.webContents.executeJavaScript(FILE_DRAG_OVER_CLEAR_JS);
  }
}

function clearFileDragOver(): void {
  const { mainWindow } = appState;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  void mainWindow.webContents.executeJavaScript(FILE_DRAG_OVER_CLEAR_JS);
}

export function registerIpc(): void {
  ipcMain.handle("evp:get-state", () => {
    const localeView = buildLocaleView(appState.locale);
    return {
    vlcDir: appState.vlcDir,
    ffmpegPath: appState.ffmpegPath,
    playbackMode: appState.playbackMode,
    playlist: appState.playlist,
    currentPath: appState.currentPath,
    locale: localeView.locale,
    ui: localeView.ui,
    localeOptions: localeView.localeOptions,
    mediaInfo:
      appState.currentPath &&
      appState.cachedMediaInfo.path === appState.currentPath
        ? appState.cachedMediaInfo
        : buildMediaInfoView(appState.currentPath),
  };
  });

  ipcMain.handle("evp:pick-vlc-dir", async () => {
    const win = appState.mainWindow;
    if (!win) return null;
    const ui = getExampleUiStrings(appState.locale);
    const p = appState.player;
    if (p?.isEmbedded()) p.hideOverlay();
    try {
      const properties: Array<'openDirectory' | 'treatPackageAsDirectory'> = [
        'openDirectory',
      ];
      if (process.platform === 'darwin') {
        properties.push('treatPackageAsDirectory');
      }
      const result = await dialog.showOpenDialog(win, {
        title: ui.pickVlcDirTitle,
        properties,
        defaultPath:
          appState.vlcDir.trim() ||
          (process.platform === 'darwin' ? '/Applications' : undefined),
      });
      return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
    } finally {
      restoreOverlayFocus(p);
    }
  });

  ipcMain.handle("evp:pick-ffmpeg-path", async () => {
    const win = appState.mainWindow;
    if (!win) return null;
    const ui = getExampleUiStrings(appState.locale);
    const p = appState.player;
    if (p?.isEmbedded()) p.hideOverlay();
    try {
      const result = await dialog.showOpenDialog(win, {
        title: ui.pickFfmpegDialogTitle,
        properties: ["openFile"],
        defaultPath: appState.ffmpegPath || undefined,
        filters: [
          { name: ui.pickFfmpegFilterExec, extensions: ["exe", "bin", "*"] },
          { name: ui.pickFfmpegFilterAll, extensions: ["*"] },
        ],
      });
      return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
    } finally {
      restoreOverlayFocus(p);
    }
  });

  ipcMain.handle("evp:pick-open-video", async () => {
    const win = appState.mainWindow;
    if (!win) return;
    const ui = getExampleUiStrings(appState.locale);
    const p = appState.player;
    if (p?.isEmbedded()) p.hideOverlay();
    try {
      const result = await dialog.showOpenDialog(win, {
        title: ui.pickOpenVideoTitle,
        properties: ["openFile"],
        filters: buildMediaFileFilters(ui),
      });
      if (!result.canceled && result.filePaths[0]) {
        await createAndEmbedPlayer();
        playPath(result.filePaths[0]);
      }
    } finally {
      restoreOverlayFocus(p);
    }
  });

  ipcMain.handle("evp:pick-add-videos", async () => {
    const win = appState.mainWindow;
    if (!win) return;
    const ui = getExampleUiStrings(appState.locale);
    const p = appState.player;
    if (p?.isEmbedded()) p.hideOverlay();
    try {
      const result = await dialog.showOpenDialog(win, {
        title: ui.pickAddVideosTitle,
        properties: ["openFile", "multiSelections"],
        filters: buildMediaFileFilters(ui),
      });
      if (!result.canceled && result.filePaths.length) {
        addToPlaylist(result.filePaths);
        if (appState.vlcDir.trim()) {
          try {
            await createAndEmbedPlayer();
          } catch (err) {
            console.error("[example] add media embed failed:", err);
          }
        }
      }
    } finally {
      restoreOverlayFocus(p);
    }
  });

  ipcMain.handle(
    "evp:restore-playlist",
    (_event, data: { playlist: PlaylistItem[]; currentPath: string | null }) => {
      if (!Array.isArray(data?.playlist)) return;
      restorePlaylist(data.playlist, data.currentPath ?? null);
    },
  );

  ipcMain.handle("evp:add-media-paths", async (_event, rawPaths: string[]) => {
    if (!Array.isArray(rawPaths)) return;
    await handleDroppedMedia(rawPaths);
  });

  ipcMain.on("evp:host-drop-files", (_event, rawPaths: string[]) => {
    if (!Array.isArray(rawPaths)) return;
    void handleDroppedMedia(rawPaths);
  });

  ipcMain.on(
    "evp:file-drag-at",
    (
      _event,
      coords: { screenX: number; screenY: number; fileDrag?: boolean },
    ) => {
      if (
        !coords ||
        typeof coords.screenX !== "number" ||
        typeof coords.screenY !== "number"
      ) {
        return;
      }
      syncFileDragOverState(
        coords.screenX,
        coords.screenY,
        coords.fileDrag === true,
      );
    },
  );

  ipcMain.on("evp:clear-file-drag-over", () => {
    clearFileDragOver();
  });

  ipcMain.handle("evp:play-path", async (_event, filePath: string) => {
    try {
      await createAndEmbedPlayer();
      appState.currentPath = filePath;
      addToPlaylist([filePath]);
      pushPlaylist();
      updateWindowTitle(filePath);
      scheduleMediaParse(filePath);
      setImmediate(() => {
        try {
          const p = requirePlayer();
          p.setSource(filePath);
          p.notifyLayoutChange();
          p.focusOverlay();
        } catch (err) {
          console.error("[example] play failed:", err);
        }
      });
    } catch (err) {
      console.error("[example] play failed:", err);
      throw err;
    }
  });

  ipcMain.handle("evp:set-vlc-dir", async (_event, dir: string) => {
    const ui = getExampleUiStrings(appState.locale);
    const trimmed = dir?.trim();
    if (!trimmed) throw new Error(ui.errorVlcDirEmpty);
    const resolved = resolveVlcDir(trimmed);
    appState.vlcDir = resolved;
    const wasPlaying = appState.currentPath;
    await recreatePlayer();
    const ver = getLibVlcVersion().version;
    pushMediaInfo({
      path: appState.currentPath,
      title: appState.currentPath ? basename(appState.currentPath) : undefined,
      filename: appState.currentPath
        ? basename(appState.currentPath)
        : undefined,
      durationText: appState.currentPath ? "—" : undefined,
      hint: formatHintLibvlcLoaded(ui, ver),
    });
    if (wasPlaying) {
      playPath(wasPlaying);
    }
  });

  ipcMain.handle("evp:set-ffmpeg-path", async (_event, rawPath: string) => {
    const ui = getExampleUiStrings(appState.locale);
    const trimmed = rawPath?.trim();
    if (!trimmed) {
      appState.ffmpegPath = "";
      if (appState.player?.isEmbedded()) {
        appState.player.setFfmpegPath("");
      }
      return;
    }
    const resolved = resolveFfmpegExecutable(trimmed);
    if (!resolved) {
      throw new Error(formatErrorInvalidFfmpegPath(ui, trimmed));
    }
    appState.ffmpegPath = resolved;
    if (appState.player?.isEmbedded()) {
      appState.player.setFfmpegPath(resolved);
    }
  });

  ipcMain.handle("evp:clear-playlist", async () => {
    clearPlaylist();
    updateWindowTitle(null);
    pushMediaInfo({ path: null });
  });

  ipcMain.handle("evp:remove-playlist-item", async (_event, filePath: string) => {
    if (typeof filePath !== "string" || !filePath.trim()) return;
    const wasCurrent = removeFromPlaylist(filePath);
    if (!wasCurrent) return;
    if (appState.currentPath) {
      updateWindowTitle(appState.currentPath);
      scheduleMediaParse(appState.currentPath);
    } else {
      updateWindowTitle(null);
      pushMediaInfo({ path: null });
    }
  });

  ipcMain.handle(
    "evp:playlist-item-menu",
    async (event, filePath: string, x: number, y: number) => {
      if (typeof filePath !== "string" || !filePath.trim()) return;
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed()) return;

      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };

        const menu = Menu.buildFromTemplate([
          {
            label: getExampleUiStrings(appState.locale).removePlaylistItem,
            click: () => {
              void (async () => {
                const wasCurrent = removeFromPlaylist(filePath);
                if (wasCurrent) {
                  if (appState.currentPath) {
                    updateWindowTitle(appState.currentPath);
                    scheduleMediaParse(appState.currentPath);
                  } else {
                    updateWindowTitle(null);
                    pushMediaInfo({ path: null });
                  }
                }
              })();
            },
          },
        ]);

        menu.popup({
          window: win,
          x: Math.round(x),
          y: Math.round(y),
          callback: finish,
        });
      });
    },
  );

  ipcMain.handle(
    "evp:set-playback-mode",
    async (_event, mode: "default" | "loop" | "repeat") => {
      const ui = getExampleUiStrings(appState.locale);
      if (mode !== "default" && mode !== "loop" && mode !== "repeat") {
        throw new Error(formatErrorInvalidPlaybackMode(ui, String(mode)));
      }
      appState.playbackMode = mode;
      appState.player?.setPlaybackMode(mode);
    },
  );

  ipcMain.handle("evp:set-locale", async (_event, locale: string) => {
    const view = buildLocaleView(locale);
    appState.locale = view.locale as typeof appState.locale;
    if (appState.player?.isEmbedded()) {
      appState.player.setLocale(view.locale);
    }
    appState.mainWindow?.webContents.send("evp:locale-changed", view);
    return view;
  });
}

export { isAppWebContents };
