# Electron VLC Player

English | [中文](README_zh.md)

Embed libVLC in Electron pages with a simpler integration path and broader video format support.

![](./Screenshot.jpg)

> [!NOTE]
> Page scrolling is not supported; the player is intended for a fixed layout region.

## Install

```bash
npm install electron-vlc-player
```

## Usage

```ts
import { BrowserWindow } from "electron";
import { VlcPlayer } from "electron-vlc-player";

const win = new BrowserWindow({ width: 1280, height: 720 });
await win.loadFile("index.html");

const player = new VlcPlayer({
  window: win,
  container: "#player",
  vlcDir: "/path/to/libvlc",
});

await player.embed();
player.setSource("/path/to/video.mkv");
player.on("playing", () => console.log("playing"));
player.setRate(1.25);
```

## Requirements

### Operating systems

| Platform    | Minimum (recommended)                                                         | Notes                                                                                         |
| ----------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Windows** | **Windows 10** 64-bit                                                         | Prebuilds are provided for **x64** only                                                       |
| **macOS**   | **macOS 11 Big Sur**                                                          | Intel (`x64`) or Apple Silicon (`arm64`)                                                      |
| **Linux**   | **Ubuntu 20.04** / **Debian 11** / **Fedora 34** or equivalent (glibc ≥ 2.31) | Embedding requires **X11** (`libX11`); pure Wayland is untested — use **XWayland** in practice. |

### Electron / Node.js

| Item         | Requirement     |
| ------------ | --------------- |
| **Electron** | **`>= 28.0.0`** |
| **Node.js**  | **`>= 18.0.0`** |

### Prebuilds

On `npm install`, a **prebuilt** `vlc_binding.node` is preferred (`prebuilds/<platform>-<arch>/`, CI in [`.github/workflows/prebuild.yml`](.github/workflows/prebuild.yml)). If no matching artifact exists or Electron is installed, the binding is **rebuilt locally** for the Electron ABI.

| Platform | Prebuilt architectures |
| -------- | ---------------------- |
| Windows  | **x64** (`win32-x64`)  |
| macOS    | **x64**, **arm64**     |
| Linux    | **x64**                |

Other architectures (e.g. Windows arm64, Linux arm64, 32-bit) require local `electron-rebuild` or `node-gyp rebuild` — see “Build native module from source” below.

### libVLC runtime and `vlcDir`

> [!IMPORTANT]
> This package **does not ship** libVLC. You must pass a libVLC root directory via **`vlcDir`** (**the library does not auto-configure it**).

> [!NOTE]
> **VLC 3.0.x only** for now (VLC 4.x embedding is still unstable).

Use **`probeDefaultVlcDir()`** to detect common VLC install paths on each platform, then pass the result to `VlcPlayer`:

```ts
import { VlcPlayer, probeDefaultVlcDir } from "electron-vlc-player";

const vlcDir = probeDefaultVlcDir();
if (!vlcDir) throw new Error("Install VLC or set vlcDir manually");

new VlcPlayer({ window: win, container: "#player", vlcDir });
```

- Option 1: user installs VLC; use `probeDefaultVlcDir()` or a manual path as `vlcDir`
- Option 2: bundle libVLC with your app and pass its **relative path inside the app** as `vlcDir` (no separate VLC install, larger app size)

The `vlcDir` folder must contain the platform libVLC library and a `plugins` directory.

#### Windows

```text
<vlcDir>/
  libvlc.dll
  libvlccore.dll
  plugins/
```

#### macOS

Usually the `MacOS` folder inside VLC.app, e.g.:

```text
/Applications/VLC.app/Contents/MacOS/
  libvlc.dylib
  libvlccore.dylib
  plugins/
```

#### Linux

Often a system package path (directory containing `libvlc.so`) with `plugins` accessible:

```text
/usr/lib/x86_64-linux-gnu/   # or /usr/lib64
  libvlc.so
```

Plugins are commonly under `/usr/lib/vlc/plugins/`. If `vlcDir` has no `plugins` subfolder, point `vlcDir` at a root that contains both `libvlc.so` and `plugins/`, or bundle the same `vlcDir/plugins` layout as on Windows.

#### Examples

```ts
import { VlcPlayer } from "electron-vlc-player";

// Windows
new VlcPlayer({
  window: win,
  container: "#player",
  vlcDir: "C:\\Program Files\\VideoLAN\\VLC",
});

// macOS
new VlcPlayer({
  window: win,
  container: "#player",
  vlcDir: "/Applications/VLC.app/Contents/MacOS",
});

// Linux
new VlcPlayer({
  window: win,
  container: "#player",
  vlcDir: "/usr/lib/x86_64-linux-gnu",
});
```

> [!NOTE]
> To **change** `vlcDir` or **hardware acceleration** (`hardwareAcceleration`) at runtime, call `destroy()` first, then create a new `VlcPlayer` with the new options.

## Integration notes

> [!WARNING]
> On **Windows**, **do not call `app.disableHardwareAcceleration()`** at app startup. It conflicts with this library’s **transparent overlay**: Chromium falls back to software compositing, fully transparent regions may become click-through to the underlying **libVLC child window**, so only the bottom bar receives clicks while the video area does not.

> [!WARNING]
> The control bar is a **child BrowserWindow** of the main window. When a system file dialog is open, if the overlay child is still visible and receives activation, Electron/Win32 may **raise that child** so the bar covers the dialog.

Hide the overlay before opening a file dialog, then restore it:

```ts
player.hideOverlay();
try {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
  });
  // ...
} finally {
  player.showOverlay();
  player.focusOverlay();
}
```

## API

### `VlcPlayer`

`VlcPlayer` extends `LibVLC` (libVLC playback API + events). **After `embed()`** you can call `player.play()`, `player.setSource()`, `player.on('playing')`, etc. directly.

**Embedding and layout:**

- `embed()` / `isEmbedded()` / `destroy()`
- `setContainer()` / `setPageFullscreen()` / `setFullScreen()` (and `isPageFullscreen()` / `isFullScreen()`)
- `hideOverlay()` / `showOverlay()` / `focusOverlay()` (file dialogs, refocus after playlist changes — see “Integration notes”)

**libVLC playback** (after `embed()`):

| Category   | Methods                                                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Media      | `setSource`, `getMediaInfo`, `parseMedia`, `getMediaMetadata` / `getMediaMetadataResult`, `getMediaTracks` / `getMediaTracksResult`, `unloadMedia`                                        |
| Playback   | `play`, `pause`, `stop`, `togglePause`, `setPaused`, `isPlaying`, `getState`, `getRate`, `setRate`, `setPlaylist`, `playPrevious`, `playNext`, `hasPrevious`, `hasNext`, `getPlaybackMode`, `setPlaybackMode` |
| Progress   | `getTime`, `setTime`, `getLength`, `getPosition`, `setPosition`, `isSeekable`                                                                                                             |
| Volume     | `getVolume`, `setVolume`, `toggleMute`, `getMute`, `setMute`, `getAudioDelay`, `setAudioDelay`                                                                                            |
| Tracks     | `getAudioTracks`, `getAudioTrack`, `setAudioTrack`, `getSubtitleTracks`, `getSubtitleTrack`, `setSubtitleTrack`, `addSubtitleFile`, `getVideoTracks`, `getVideoTrack`, `setVideoTrack`   |
| Video      | `getScale`, `setScale`, `getAspectRatio`, `setAspectRatio`, `setCropGeometry`, `getVideoSize`, `takeSnapshot`                                                                             |
| Chapters   | `getChapter`, `setChapter`, `nextChapter`, `previousChapter`, `getTitleDescriptions`, etc.                                                                                                |
| Other      | `navigate`, `setVlcFullscreen`, `setRole`, `getFps`, `hasVout`                                                                                                                            |

Constants: `VlcState`, `VlcNavigate`, `VlcRole`, `VlcEvent`, `VlcEventName`.

### Events

```ts
const onPlaying = () => console.log("playing");
player.on("playing", onPlaying);
player.off("playing", onPlaying);

player.on("endReached", (ev) => console.log("ended", ev.time));
```

Common events: `playing` | `paused` | `stopped` | `endReached` | `timeChanged` | `positionChanged` | `lengthChanged` | `buffering` | `error` | `playlistItemChanged` (see `VlcEventName`).

### Control bar “page fullscreen” button

- Constructor option `pageFullscreenButton` (default `true`): set to `false` to hide the page-fullscreen button.

#### Hardware acceleration

libVLC accepts **`--avcodec-hw=`** for decode hardware acceleration.

| Value               | Description                          |
| ------------------- | ------------------------------------ |
| `none`              | Disable HW decode (**default**)      |
| `any`               | Let libVLC pick an available backend |
| `d3d11va` / `dxva2` | Common on Windows                    |
| `vaapi` / `drm`     | Common on Linux                      |
| `videotoolbox`      | macOS                                |

```ts
import {
  VlcPlayer,
  getHardwareAcceleration,
  setHardwareAcceleration,
} from "electron-vlc-player";

const player = new VlcPlayer({
  window: win,
  container: "#player",
  vlcDir: "C:\\Program Files\\VideoLAN\\VLC",
  hardwareAcceleration: "d3d11va",
});

console.log(getHardwareAcceleration()); // "d3d11va"

// Changing mode requires a new instance
await player.destroy();
setHardwareAcceleration("any");
const player2 = new VlcPlayer({ window: win, container: "#player", vlcDir });
```

### Seek-bar hover preview

The control bar can offline-generate hover preview sprites for **local files** (similar to streaming sites). **Network URLs / streams** cannot generate or show hover previews.

> [!NOTE]
> VLC 3.x has no reliable background snapshot API at arbitrary times. An invisible second player was tried but worked poorly, so **ffmpeg** is used to build preview sprites.
>
> Generation time depends on resolution; 1080p and below is usually acceptable; 2K/4K can be slow.

**Requirements:**

1. Media is a local path or `file://` (see `isLocalMediaSource()`)
2. Pass **`ffmpegPath`** when constructing `VlcPlayer`, or call `setFfmpegPath` later (**not auto-detected**)

Use `probeDefaultFfmpegPath()` to help find ffmpeg:

```ts
new VlcPlayer({
  window: win,
  container: "#player",
  vlcDir: probeDefaultVlcDir() ?? "/path/to/libvlc",
  ffmpegPath: probeDefaultFfmpegPath() ?? undefined, // or "C:\\ffmpeg\\bin\\ffmpeg.exe"
  seekPreviewCacheDir: "D:/cache/evp-preview", // optional, default %TEMP%/evp-preview
});
```

Without a valid ffmpeg path, the **Generate preview** button is hidden.

**Flow:**

1. Open a local file, click **Generate preview** on the control bar (shows progress; cannot click again while running)
2. ffmpeg decodes once in order (tries `-hwaccel auto`, falls back to software), outputs `sprite.jpg` via `fps → scale → tile`
3. After completion, hovering the progress bar shows previews instantly

**Cache layout** (default `%TEMP%/evp-preview`, shared globally):

```text
{seekPreviewCacheDir}/{mediaKey}/index.json
{seekPreviewCacheDir}/{mediaKey}/sprite.jpg
```

| API                                                                                     | Description                                      |
| --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `ffmpegPath` (option) / `setFfmpegPath` / `getFfmpegPath`                               | ffmpeg executable path (process-wide)            |
| `seekPreviewCacheDir` (option) / `setSeekPreviewCacheDir` / `getSeekPreviewCacheDir`    | Preview sprite cache root (process-wide)         |
| `clearSeekPreviewCacheDir()`                                                            | Cancel in-flight generation and clear cache root |
| `generateSeekPreviewSprite()`                                                           | Generate sprite for current local media          |
| `cancelSeekPreviewSprite()`                                                             | Cancel generation (removes `.work/` only)        |

Changing media or calling `destroy()` **does not** delete finished sprites; call `clearSeekPreviewCacheDir()` or delete directories manually. If sprites exist on disk but ffmpeg is not configured: **button hidden**, **hover still uses cache**.

Long videos use adaptive spacing (~300 frames max): `intervalMs = max(2000, ceil(durationMs/300/1000)*1000)`.

```ts
import {
  VlcPlayer,
  probeDefaultVlcDir,
  probeDefaultFfmpegPath,
} from "electron-vlc-player";

const player = new VlcPlayer({
  window: win,
  container: "#player",
  vlcDir: probeDefaultVlcDir() ?? "/path/to/libvlc",
  ffmpegPath: probeDefaultFfmpegPath() ?? undefined,
  seekPreviewCacheDir: "D:/cache/evp-preview", // optional
});

player.on("seekPreviewError", (err) => console.error(err));
player.generateSeekPreviewSprite(); // or use control bar button
```

### Playlist and previous/next controls

The built-in control bar can show **Previous** / **Next** beside the play button.

- Pass paths/URLs via constructor `playlist: string[]` or `setPlaylist(paths)` (independent of your own UI list — sync the same array to enable buttons).
- Buttons appear only with **at least 2** items; hidden with 0–1 items.
- `playPrevious()` / `playNext()` switch within the list; `hasPrevious()` / `hasNext()` indicate availability.
- Default `autoAdvancePlaylist: true`: on `endReached`, plays the next item if any (`playNext()`).
- **`playbackMode`** (default `default`): end-of-item behavior — `loop` (list), `repeat` (single item); use `getPlaybackMode()` / `setPlaybackMode()`.
- **`locale`** (optional): control bar UI language (BCP 47, e.g. `zh-CN`, `en`, `ja`). Omitted: auto from Electron/system; falls back to English. See `SUPPORTED_PLAYER_LOCALES`; runtime `setLocale()` / `getLocale()`.
- Switching via control bar or API emits `playlistItemChanged` (`{ src, index }`) for title/sidebar updates; **the player already called `setSource` — listeners need not call it again**.

```ts
player.setPlaylist(["/a.mkv", "/b.mkv", "/c.mkv"]);
player.setPlaybackMode("loop"); // or "repeat" | "default"
player.on("playlistItemChanged", ({ src, index }) => {
  console.log("now playing", index, src);
});
```

Track changes (control bar audio/subtitle menus or `set*Track`):

```ts
player.on("audioTrackChanged", ({ trackId }) => {
  /* current audio track id */
});
player.on("videoTrackChanged", ({ trackId }) => {
  /* current video track id */
});
player.on("subtitleTrackChanged", ({ trackId }) => {
  /* trackId === -1 means subtitles off */
});
```

Custom overlay context menu (coordinates relative to overlay client area):

```ts
import { Menu } from "electron";

player.on("overlayContextMenu", () => {
  Menu.buildFromTemplate([
    { label: "Copy path", click: () => console.log(player.getSource()) },
  ]).popup({ window: win });
});
```

Use `parseMedia()` for metadata, tracks, and duration.

> libVLC 3 reads track tables via `libvlc_media_tracks_get` (or legacy `libvlc_media_get_tracks_info`); calling while playing may be unstable — the library may fall back to switchable track lists.

```ts
player.setSource("/path/to/video.mp4");
player
  .parseMedia()
  .then(({ metadata, tracks, tracksNotice, length, info }) => {
    console.log(metadata.title, tracks, length);
  })
  .catch((err) => console.error(err));
```

`tracks` lists streams in the file (including `width`/`height` per video track); **which track is active** uses `getVideoTrack()` / `getAudioTrack()` / `getSubtitleTrack()` (below).

**Selected tracks** (libVLC track ids matching `get*Tracks()`; subtitles off = `-1`):

```ts
const videoId = player.getVideoTrack();
const audioId = player.getAudioTrack();
const subId = player.getSubtitleTrack(); // -1 = no subtitles

const video = player.getVideoTracks().find((t) => t.id === videoId);
const audio = player.getAudioTracks().find((t) => t.id === audioId);
```

While playing, `getVideoSize()` and `getFps()` return **current decoded** resolution and frame rate.

After parse, `getMediaMetadataResult()` returns metadata; while playing, `getMediaTracksResult()` returns file streams.

> [!WARNING]
> **Do not read media track tables while paused** (can crash). Prefer during playback or after stop.

```ts
const { data: meta, notice } = player.getMediaMetadataResult();
const { data: tracks, notice: tracksNotice } = player.getMediaTracksResult();
// If not parsed, `notice` suggests calling parseMedia() first; non-empty notice means incomplete data
```

#### `probeMedia()` — without loading into the player

`parseMedia()` applies to the **current `setSource` media**. To pre-read duration/basic metadata for a playlist entry without switching playback, use package-level **`probeMedia()`**:

- Does **not** change current source or start playback
- Requires initialized libVLC (e.g. after `VlcPlayer.embed()`)
- Returns `MediaProbeResult`: `parsed`, `length` (ms, 0 if unknown), `metadata` (`title` / `artist` / `album` / `genre`)
- **No** track list, resolution, or fps — use `parseMedia()` or `getVideoSize()` / `getFps()` after playback

```ts
import { probeMedia } from "electron-vlc-player";

// Probe playlist entries in the background (queue yourself to avoid blocking UI)
const { parsed, length, metadata } = probeMedia("/path/to/video.mkv", 15_000);
if (parsed && length > 0) {
  console.log(metadata.title, length);
}
```

Low-level binding: `getBinding()` returns the full `VlcBinding`. `getLibVlcVersion()` queries libVLC version.

`mediaOptions` example:

```ts
player.setSource("https://example.com/live.m3u8", {
  mediaOptions: [":network-caching=3000"],
});
```

Custom context menu: listen for `overlayContextMenu` (`{ x, y }` in overlay client coords) then `Menu.popup`.

### Utilities

- `probeMedia(src, timeoutMs?)` — parse duration and basic metadata without loading into the player (requires init libVLC); returns `MediaProbeResult`
- `probeDefaultVlcDir()` — optionally detect common VLC / libVLC install paths (`string | null`)
- `resolveVlcDir(vlcDir)` — validate and normalize libVLC directory
- `getHardwareAcceleration()` / `setHardwareAcceleration(mode)` — query or set process-wide `--avcodec-hw`
- `normalizeHardwareAcceleration(mode)` — validate HW acceleration value
- `probeDefaultFfmpegPath()` — optionally detect common ffmpeg paths and `PATH` (`string | null`)
- `resolveFfmpegExecutable(path)` — validate ffmpeg executable

### Built-in shortcuts

When the overlay has focus, mouse and keyboard shortcuts are available.

**Mouse**

| Action      | Effect           |
| ----------- | ---------------- |
| Mouse wheel | Volume ±1%       |
| Click       | Play / pause     |
| Double-click| Toggle fullscreen|

**Keyboard**

| Key                 | Effect                          |
| ------------------- | ------------------------------- |
| `Space`             | Play / pause                    |
| `T`                 | Toggle page fullscreen          |
| `F`                 | Toggle fullscreen               |
| `Esc`               | Exit fullscreen / page fullscreen |
| `←` / `→`           | Seek −10s / +10s                |
| `Shift` + `←` / `→` | Seek −3s / +3s                  |
| `Ctrl` + `←` / `→`  | Seek −1m / +1m                  |
| `Alt` + `←` / `→`   | Seek −1 / +1 frame              |
| `↑` / `↓`           | Volume +10% / −10%              |

### Build native module from source

Install platform build tools, then run `npm run rebuild` (in your app: `npx electron-rebuild -f -w electron-vlc-player`):

| Platform    | Dependencies                                                      |
| ----------- | ----------------------------------------------------------------- |
| **Windows** | Visual Studio Build Tools (“Desktop development with C++”), Python 3 |
| **macOS**   | Xcode Command Line Tools                                          |
| **Linux**   | `build-essential`, `libx11-dev`, Python 3                         |

Set `SKIP_EVP_NATIVE_REBUILD=1` to skip automatic rebuild in the `install` script.

## Source layout

```text
src/
  index.ts                 # Public exports
  types.ts                 # Public TypeScript types (MediaQueryResult, etc.)
  native.ts                # N-API binding load, initLibVlc, probeMedia
  vlc-path.ts              # vlcDir detection and validation
  vlc-constants.ts         # libVLC state / event / track constants
  vlc-event-names.ts       # Event name mapping
  hardware-acceleration.ts
  seek-preview-sprite.ts   # Seek-bar preview sprites (ffmpeg)
  overlay-path.ts          # Resolve overlay assets after build
  i18n/                    # Control bar locales
  libvlc/
    LibVLC.ts              # libVLC media player API (parse / tracks / playback)
    index.ts
  vlc-player/              # Electron embedding (controllers)
    VlcPlayer.ts           # Main entry, extends LibVLC
    layout.ts              # Window / container layout and native embed
    playlist.ts            # Playlist and loop / repeat
    overlay/               # Transparent overlay window
    seek.ts, ipc.ts, …
overlay/                   # Built-in controls (HTML/CSS/JS, loaded in overlay)
example/src/               # Electron example (main process modules)
```

`VlcPlayer` extends `LibVLC`: embedding and UI live in `vlc-player/`; playback and media parsing in `libvlc/`.

## How It Works

The player stacks three layers inside your Electron window:

![How It Works](./How_It_Works.jpg)

| Layer | Role |
| ----- | ---- |
| **Page container element** | A DOM element in your renderer page (`container`, e.g. `#stage`). The library measures its bounds and anchors both the video surface and overlay to this region. |
| **libVLC embed layer** | A native child window created by the N-API binding. libVLC decodes and renders video into this surface. |
| **Overlay control layer** | A transparent child `BrowserWindow` aligned with the container, loaded with built-in HTML/CSS/JS controls. User input and state updates are bridged to the main process via IPC. |

Call `embed()` after the page loads to create and align these layers. Container resize, page fullscreen, and window fullscreen are handled automatically.

## License

MIT
