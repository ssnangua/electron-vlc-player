import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { handleDroppedMedia } from "./playlist-service";
import { createWindow } from "./window";
import { isAppWebContents } from "./ipc-handlers";

// 不要加这行，否则透明 overlay 控制层会感应不到鼠标事件
// app.disableHardwareAcceleration();

// 关闭 Chromium 崩溃上报，避免 Windows 上误导性的 crashpad stderr
app.commandLine.appendSwitch("disable-crash-reporter");
process.env.ELECTRON_DISABLE_CRASH_REPORTER = "1";

// 把 Electron/Chromium 配置与缓存放到系统临时目录，避免污染用户默认 userData。
// 与 libVLC 播放无关，仅影响窗口内 Chromium 的本地数据。
const demoUserData = path.join(os.tmpdir(), "electron-vlc-player-example");
app.setPath("userData", demoUserData);
// disk-cache-dir：Chromium 磁盘缓存（网络/资源等）目录，与 userData 同放在 demo 目录下便于清理。
app.commandLine.appendSwitch(
  "disk-cache-dir",
  path.join(demoUserData, "disk-cache"),
);
// disable-gpu-shader-disk-cache：不写 GPU 着色器磁盘缓存，减少临时目录权限/损坏问题。
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

app.whenReady().then(() => {
  // Menu.setApplicationMenu(null);
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (event, url) => {
      if (!url.startsWith("file://")) return;
      if (!isAppWebContents(contents)) return;
      event.preventDefault();
      try {
        void handleDroppedMedia([fileURLToPath(url)]);
      } catch {
        // ignore malformed file URL
      }
    });
  });
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
