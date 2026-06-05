# Electron VLC Player — Example

[English](README.md) | 中文

基于 [electron-vlc-player](https://www.npmjs.com/package/electron-vlc-player) 的 Electron 桌面播放器。

![](../Screenshot.jpg)

## 前置条件

完整平台 / Electron / libVLC 版本说明见仓库根目录 [README § 要求](../README_zh.md#要求)（[English](../README.md#requirements)）。

简要：

1. 已安装 [VLC](https://www.videolan.org/vlc/) **3.0.x**（libVLC + `plugins`；暂不支持 VLC 4.x）
2. **Electron >= 28**（本 example 使用 33.x）、**Node.js >= 18**（推荐 20/22）
3. **Windows 10+** / **macOS 11+** / **Linux（X11）**
4. Windows 上编译 native 需 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（含「使用 C++ 的桌面开发」）

## 启动应用

```bash
npm install
npm run dev
```

## 本仓库开发

```bash
npm install
npm run link         # 将依赖切换为本地 `electron-vlc-player@file:..`
npm run rebuild      # 重编本地 `electron-vlc-player`
npm run dev
```

每次改完库逻辑，只需：

```bash
npm run rebuild
npm run dev
```

| 命令                  | 作用                                                                   |
| --------------------- | ---------------------------------------------------------------------- |
| **`npm run compile`** | 仅编译 example 的 TypeScript → `dist/`                                 |
| **`npm run dev`**     | 编译 + 检查库产物 + 启动 Electron（日常开发）                          |
| **`npm start`**       | 同 **`npm run dev`**                                                   |
| **`npm run link`**    | 将依赖切换为本地 `electron-vlc-player@file:..`，并安装根目录 dev 依赖  |
| **`npm run rebuild`** | **重编整个库**：根目录 `tsc` + 按当前 Electron 重编 `vlc_binding.node` |
| **`npm run pack`**    | 编译 + 打包为未安装目录（`release/win-unpacked/` 等，便于快速验证）   |
| **`npm run build`**   | 编译 + 生成安装包（Windows NSIS、macOS DMG、Linux AppImage）→ `release/` |
| **`npm run dist`**    | 同 **`npm run build`**                                                 |
| **`npm run unlink`**  | 改回 npm 上最新版本的 `electron-vlc-player`                            |

`npm install` 的 postinstall 会执行与 `rebuild` 相同的步骤（首次较慢）。

## 打包发布

```bash
npm run build
```

产物在 `example/release/`。安装包**不包含 libVLC**，目标机器仍需单独安装 [VLC 3.x](https://www.videolan.org/vlc/)；首次启动若未探测到路径，可在顶栏手动选择 VLC 目录。

若当前使用 `npm run link` 本地链接，打包脚本会自动 `npm pack` 一份可发布副本（避免把整个仓库根目录打进 asar）；打包完成后可再执行 `npm run link` 恢复开发链接。

仅验证打包结果、不生成安装程序时：

```bash
npm run pack
```

## 页面布局

三行结构：顶栏 → 中间（播放器 + 播放列表）→ 底栏（整行）。

页面 `preload` 暴露 `window.evpLayout.notify()`，供播放器对 `#stage` 的 `ResizeObserver` 回调主进程同步布局。

- **顶栏**：打开媒体、VLC 路径、FFmpeg 路径
- **中间**：`#stage`（libVLC 画面与 overlay 控制条）+ 播放列表侧栏（footer：添加 / 清空 / 循环模式）
- **底栏**：当前媒体信息

## 最小播放测试（排查崩溃）

必须用 **Electron** 启动（不要用 `node scripts/smoke-play.cjs`，否则 `app` 为 undefined）。

使用 `test/smoke.html` 作为嵌入页（`data:` URL 会导致容器尺寸为 0，仅有声音无画面）。默认播放 `test/nice.mp4`：

```bash
npm run smoke-play
```

指定其它文件：

```bash
npm run smoke-play -- "C:\path\to\video.mkv"
```

## VLC 路径

启动时 example 调用库提供的 **`probeDefaultVlcDir()`** 探测本机 VLC；未检测到可在顶栏「选择 VLC 目录」手动指定（仍通过 `resolveVlcDir` 校验）。macOS 上可选 `/Applications/VLC.app` 或 `Contents/MacOS`（VLC 3.0.x 的 dylib 常在 `MacOS/lib/`，库会自动解析到正确 `vlcDir`）。

在仓库根目录开发时请先 **`npm run link`** 再 **`npm run rebuild`**，否则 example 可能仍使用 npm 缓存的旧版库。

## 进度条悬停预览（ffmpeg）

控制栏「**生成预览**」需要 **本地视频文件** + 构造 `VlcPlayer` 时传入 **`ffmpegPath`**（或之后 `setFfmpegPath`）。库本身不会自动探测。

example 在 `main.ts` 里演示：`probeDefaultFfmpegPath()` 探测成功后作为 `ffmpegPath` 传入构造函数。若未探测到，可写死路径，例如：

```ts
new VlcPlayer({
  window: mainWindow,
  container: "#stage",
  vlcDir: resolved,
  ffmpegPath: "C:\\ffmpeg\\bin\\ffmpeg.exe",
});
```

未配置时终端会提示：

```text
[example] ffmpeg not found; call VlcPlayer.setFfmpegPath(...) in main.ts ...
[electron-vlc-player] ffmpeg path not configured; seek preview unavailable
```

配置成功并打开**本地文件**后，控制栏时间右侧会出现「生成预览」按钮。

## 常见日志与报错

- **`crashpad_client_win.cc(868) not connected`**：崩溃附带日志；若异常请 `npm run rebuild` 后再 `npm run dev`。
- **`Cannot find module '...\vlc_binding.node'`** 或 **缺少 `dist/`**：`npm run rebuild`。
- 画面区点不到鼠标：勿在应用入口调用 `app.disableHardwareAcceleration()`（见根目录 README「集成注意」）。
