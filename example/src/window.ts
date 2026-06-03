import path from "node:path";
import { BrowserWindow } from "electron";
import { APP_TITLE, appState } from "./app-state";
import { getExampleUiStrings } from "./shared/example-i18n";
import { registerIpc } from "./ipc-handlers";
import { pushMediaInfo } from "./media-info";
import {
  createAndEmbedPlayer,
  destroyPlayer,
} from "./player-session";

export function createWindow(): void {
  registerIpc();

  // Windows/Linux 默认 width/height 为「外框」尺寸；useContentSize 使 1280×720 指网页内容区（与 macOS 一致）。
  appState.mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    useContentSize: true,
    minWidth: 800,
    minHeight: 480,
    title: APP_TITLE,
    show: false,
    // autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  appState.mainWindow.loadFile(
    path.join(__dirname, "renderer", "index.html"),
  );

  appState.mainWindow.once("ready-to-show", () => {
    if (!appState.mainWindow) return;
    void (async () => {
      if (!appState.vlcDir.trim()) {
        pushMediaInfo({
          path: null,
          notice: getExampleUiStrings(appState.locale).noticeSetupVlc,
        });
        appState.mainWindow?.show();
        return;
      }
      try {
        await createAndEmbedPlayer();
      } catch (err) {
        console.error("[example] player init failed:", err);
        pushMediaInfo({
          path: null,
          notice: err instanceof Error ? err.message : String(err),
        });
      }
      appState.mainWindow?.show();
    })();
  });

  appState.mainWindow.on("close", () => {
    destroyPlayer();
  });

  appState.mainWindow.on("closed", () => {
    appState.mainWindow = null;
  });
}
