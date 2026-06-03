import type { MediaInfoView, PlaylistItem, StoredPlaylist } from '../shared/evp-api';

const SIDEBAR_WIDTH_KEY = 'evp-example-sidebar-width';
const BOTTOM_BAR_HEIGHT_KEY = 'evp-example-bottom-bar-height';
const PLAYLIST_STORAGE_KEY = 'evp-example-playlist';
const SIDEBAR_DEFAULT = 260;
const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 560;
const MAIN_MIN = 320;
const BOTTOM_BAR_DEFAULT = 140;
const BOTTOM_BAR_MIN = 80;
const BOTTOM_BAR_MAX = 480;
const WORKSPACE_MIN = 200;

function cssLengthVar(name: string, fallback: number): number {
  const raw = getComputedStyle(document.body).getPropertyValue(name).trim();
  const px = parseFloat(raw);
  return Number.isFinite(px) && px >= 0 ? px : fallback;
}

function panelGap(): number {
  return cssLengthVar('--panel-gap', 5);
}

function topBarHeight(): number {
  return cssLengthVar('--top-bar-height', 44);
}

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing #${id}`);
  }
  return el as T;
}

const vlcDirInput = requireElement<HTMLInputElement>('vlc-dir');
const ffmpegPathInput = requireElement<HTMLInputElement>('ffmpeg-path');
const sidebar = requireElement<HTMLElement>('sidebar');
const sidebarResizer = requireElement<HTMLElement>('sidebar-resizer');
const bottomBar = requireElement<HTMLElement>('bottom-bar');
const bottomBarResizer = requireElement<HTMLElement>('bottom-bar-resizer');
const btnPickVlc = requireElement<HTMLButtonElement>('btn-pick-vlc');
const btnPickFfmpeg = requireElement<HTMLButtonElement>('btn-pick-ffmpeg');
const btnOpenVideo = requireElement<HTMLButtonElement>('btn-open-video');
const btnAddVideos = requireElement<HTMLButtonElement>('btn-add-videos');
const btnClearPlaylist = requireElement<HTMLButtonElement>('btn-clear-playlist');
const btnLoopMode = requireElement<HTMLButtonElement>('btn-loop-mode');
const loopModeIcon = requireElement<HTMLImageElement>('loop-mode-icon');
const loopModeLabel = requireElement<HTMLSpanElement>('loop-mode-label');
const playlistEl = requireElement<HTMLUListElement>('playlist');
const mediaInfoEl = requireElement<HTMLDivElement>('media-info-lines');

const LOOP_MODES = [
  { mode: 'default' as const, icon: 'assets/off-loop.svg', label: '不循环' },
  { mode: 'loop' as const, icon: 'assets/loop.svg', label: '列表循环' },
  { mode: 'repeat' as const, icon: 'assets/repeat.svg', label: '单文件循环' },
];

let loopModeIndex = 0;

let currentPath: string | null = null;

function sidebarMaxWidth(): number {
  return Math.min(
    SIDEBAR_MAX,
    Math.max(SIDEBAR_MIN, window.innerWidth - MAIN_MIN - panelGap()),
  );
}

function clampSidebarWidth(px: number): number {
  return Math.min(sidebarMaxWidth(), Math.max(SIDEBAR_MIN, Math.round(px)));
}

function applySidebarWidth(px: number): void {
  const width = clampSidebarWidth(px);
  document.body.style.setProperty('--sidebar-width', `${width}px`);
  sidebarResizer.setAttribute('aria-valuenow', String(width));
}

function notifyPlayerLayout(): void {
  window.evpLayout?.notify();
}

function loadSidebarWidth(): void {
  const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  if (!Number.isFinite(stored) || stored <= 0) {
    applySidebarWidth(SIDEBAR_DEFAULT);
    return;
  }
  if (stored < SIDEBAR_MIN || stored > SIDEBAR_MAX * 2) {
    localStorage.removeItem(SIDEBAR_WIDTH_KEY);
    applySidebarWidth(SIDEBAR_DEFAULT);
    return;
  }
  applySidebarWidth(stored);
}

function saveSidebarWidth(): void {
  localStorage.setItem(
    SIDEBAR_WIDTH_KEY,
    String(clampSidebarWidth(sidebar.getBoundingClientRect().width)),
  );
}

function initSidebarResizer(): void {
  loadSidebarWidth();

  sidebarResizer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    sidebarResizer.setPointerCapture(event.pointerId);

    const startX = event.clientX;
    const startWidth = sidebar.getBoundingClientRect().width;

    const onPointerMove = (ev: PointerEvent) => {
      const next = startWidth - (ev.clientX - startX);
      applySidebarWidth(next);
      notifyPlayerLayout();
    };

    const onPointerUp = (ev: PointerEvent) => {
      sidebarResizer.releasePointerCapture(ev.pointerId);
      sidebarResizer.removeEventListener('pointermove', onPointerMove);
      sidebarResizer.removeEventListener('pointerup', onPointerUp);
      sidebarResizer.removeEventListener('pointercancel', onPointerUp);
      document.body.classList.remove('col-resizing');
      saveSidebarWidth();
      notifyPlayerLayout();
    };

    document.body.classList.add('col-resizing');
    sidebarResizer.addEventListener('pointermove', onPointerMove);
    sidebarResizer.addEventListener('pointerup', onPointerUp);
    sidebarResizer.addEventListener('pointercancel', onPointerUp);
  });

  window.addEventListener('resize', () => {
    applySidebarWidth(sidebar.getBoundingClientRect().width);
    notifyPlayerLayout();
  });
}

initSidebarResizer();

function bottomBarMaxHeight(): number {
  return Math.min(
    BOTTOM_BAR_MAX,
    Math.max(
      BOTTOM_BAR_MIN,
      window.innerHeight - topBarHeight() - WORKSPACE_MIN - panelGap(),
    ),
  );
}

function clampBottomBarHeight(px: number): number {
  return Math.min(bottomBarMaxHeight(), Math.max(BOTTOM_BAR_MIN, Math.round(px)));
}

function applyBottomBarHeight(px: number): void {
  const height = clampBottomBarHeight(px);
  document.body.style.setProperty('--bottom-bar-height', `${height}px`);
  bottomBarResizer.setAttribute('aria-valuenow', String(height));
}

function loadBottomBarHeight(): void {
  const stored = Number(localStorage.getItem(BOTTOM_BAR_HEIGHT_KEY));
  if (!Number.isFinite(stored) || stored <= 0) {
    applyBottomBarHeight(BOTTOM_BAR_DEFAULT);
    return;
  }
  if (stored < BOTTOM_BAR_MIN || stored > BOTTOM_BAR_MAX * 2) {
    localStorage.removeItem(BOTTOM_BAR_HEIGHT_KEY);
    applyBottomBarHeight(BOTTOM_BAR_DEFAULT);
    return;
  }
  applyBottomBarHeight(stored);
}

function saveBottomBarHeight(): void {
  localStorage.setItem(
    BOTTOM_BAR_HEIGHT_KEY,
    String(clampBottomBarHeight(bottomBar.getBoundingClientRect().height)),
  );
}

function initBottomBarResizer(): void {
  loadBottomBarHeight();

  bottomBarResizer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    bottomBarResizer.setPointerCapture(event.pointerId);

    const startY = event.clientY;
    const startHeight = bottomBar.getBoundingClientRect().height;

    const onPointerMove = (ev: PointerEvent) => {
      const next = startHeight - (ev.clientY - startY);
      applyBottomBarHeight(next);
      notifyPlayerLayout();
    };

    const onPointerUp = (ev: PointerEvent) => {
      bottomBarResizer.releasePointerCapture(ev.pointerId);
      bottomBarResizer.removeEventListener('pointermove', onPointerMove);
      bottomBarResizer.removeEventListener('pointerup', onPointerUp);
      bottomBarResizer.removeEventListener('pointercancel', onPointerUp);
      document.body.classList.remove('row-resizing');
      saveBottomBarHeight();
      notifyPlayerLayout();
    };

    document.body.classList.add('row-resizing');
    bottomBarResizer.addEventListener('pointermove', onPointerMove);
    bottomBarResizer.addEventListener('pointerup', onPointerUp);
    bottomBarResizer.addEventListener('pointercancel', onPointerUp);
  });

  window.addEventListener('resize', () => {
    applyBottomBarHeight(bottomBar.getBoundingClientRect().height);
    notifyPlayerLayout();
  });
}

initBottomBarResizer();

function basename(filePath: string): string {
  const i = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return i >= 0 ? filePath.slice(i + 1) : filePath;
}

function loadPlaylistFromStorage(): StoredPlaylist | null {
  try {
    const raw = localStorage.getItem(PLAYLIST_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPlaylist;
    if (!Array.isArray(parsed.playlist)) return null;
    return {
      playlist: parsed.playlist.filter(
        (item): item is PlaylistItem =>
          typeof item?.path === 'string' &&
          item.path.length > 0 &&
          (item.durationText === undefined || typeof item.durationText === 'string'),
      ),
      currentPath: typeof parsed.currentPath === 'string' ? parsed.currentPath : null,
    };
  } catch {
    localStorage.removeItem(PLAYLIST_STORAGE_KEY);
    return null;
  }
}

function savePlaylistToStorage(playlist: PlaylistItem[], currentPath: string | null): void {
  const payload: StoredPlaylist = { playlist, currentPath };
  localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(payload));
}

function renderPlaylist(items: PlaylistItem[], activePath: string | null): void {
  playlistEl.innerHTML = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '暂无条目，请添加或打开媒体';
    playlistEl.appendChild(li);
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'playlist-columns';
    const filePath = item.path;
    li.title = filePath;
    li.dataset.path = filePath;

    const titleEl = document.createElement('span');
    titleEl.className = 'col-title';
    titleEl.textContent = item.title || basename(filePath);

    const durationEl = document.createElement('span');
    durationEl.className = 'col-duration';
    durationEl.textContent = item.durationText?.trim() || '—';

    li.append(titleEl, durationEl);
    if (filePath === activePath) {
      li.classList.add('active');
    }
    playlistEl.appendChild(li);
  }
}

playlistEl.addEventListener('contextmenu', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const li = target.closest('li');
  if (!li || li.classList.contains('empty')) return;
  const path = li.dataset.path;
  if (!path) return;
  event.preventDefault();
  void window.evp.showPlaylistItemMenu(path, event.clientX, event.clientY);
});

playlistEl.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const li = target.closest('li');
  if (!li || li.classList.contains('empty')) return;
  const path = li.dataset.path;
  if (!path) return;
  try {
    await window.evp.playPath(path);
  } catch (err) {
    alert(`播放失败：${formatError(err)}`);
  }
});

function renderMediaInfo(info: MediaInfoView | null | undefined): void {
  if (!info?.path) {
    mediaInfoEl.innerHTML = '<span class="muted">未加载媒体</span>';
    return;
  }
  const lines = [
    `标题：${info.title || info.filename || basename(info.path)}`,
    ...(info.artist ? [`艺术家：${info.artist}`] : []),
    ...(info.album ? [`专辑：${info.album}`] : []),
    ...(info.genre ? [`流派：${info.genre}`] : []),
    `路径：${info.path}`,
    `时长：${info.durationText || '—'}`,
    `分辨率：${info.resolution || '—'}`,
    `帧率：${info.fps != null && info.fps > 0 ? `${info.fps.toFixed(2)} fps` : '—'}`,
  ];
  if (info.streams?.length) {
    for (const s of info.streams) {
      const head = `${s.type}（${s.codec || '—'}）`;
      lines.push(s.details ? `${head}：${s.details}` : head);
    }
  }
  if (info.notice) {
    lines.push(`提示：${info.notice}`);
  }
  mediaInfoEl.innerHTML = lines.map((t) => `<span>${escapeHtml(t)}</span>`).join('');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function applyVlcDir(dir: string): Promise<void> {
  vlcDirInput.value = dir;
  await window.evp.setVlcDir(dir);
}

async function applyFfmpegPath(filePath: string): Promise<void> {
  ffmpegPathInput.value = filePath;
  await window.evp.setFfmpegPath(filePath);
}

function applyLoopModeUi(mode: (typeof LOOP_MODES)[number]['mode']): void {
  const index = LOOP_MODES.findIndex((entry) => entry.mode === mode);
  loopModeIndex = index >= 0 ? index : 0;
  const entry = LOOP_MODES[loopModeIndex];
  loopModeIcon.src = entry.icon;
  loopModeLabel.textContent = entry.label;
  btnLoopMode.title = entry.label;
}

async function applyLoopMode(mode: (typeof LOOP_MODES)[number]['mode']): Promise<void> {
  applyLoopModeUi(mode);
  await window.evp.setPlaybackMode(mode);
}

btnPickVlc.addEventListener('click', async () => {
  const dir = await window.evp.pickVlcDir();
  if (dir) {
    await applyVlcDir(dir);
  }
});

btnPickFfmpeg.addEventListener('click', async () => {
  const filePath = await window.evp.pickFfmpegPath();
  if (filePath) {
    try {
      await applyFfmpegPath(filePath);
    } catch (err) {
      alert(formatError(err));
    }
  }
});

ffmpegPathInput.addEventListener('change', async () => {
  const filePath = ffmpegPathInput.value.trim();
  try {
    await applyFfmpegPath(filePath);
  } catch (err) {
    alert(formatError(err));
  }
});

vlcDirInput.addEventListener('change', async () => {
  const dir = vlcDirInput.value.trim();
  if (!dir) return;
  try {
    await applyVlcDir(dir);
  } catch (err) {
    alert(formatError(err));
  }
});

btnOpenVideo.addEventListener('click', async () => {
  try {
    await window.evp.pickOpenVideo();
  } catch (err) {
    alert(`打开媒体失败：${formatError(err)}`);
  }
});

btnAddVideos.addEventListener('click', async () => {
  await window.evp.pickAddVideos();
});

btnClearPlaylist.addEventListener('click', async () => {
  try {
    await window.evp.clearPlaylist();
  } catch (err) {
    alert(formatError(err));
  }
});

btnLoopMode.addEventListener('click', async () => {
  loopModeIndex = (loopModeIndex + 1) % LOOP_MODES.length;
  try {
    await applyLoopMode(LOOP_MODES[loopModeIndex].mode);
  } catch (err) {
    alert(formatError(err));
  }
});

window.evp.onPlaylist((data) => {
  currentPath = data.currentPath;
  renderPlaylist(data.playlist, currentPath);
  savePlaylistToStorage(data.playlist, data.currentPath);
});

window.evp.onMediaInfo((info) => {
  renderMediaInfo(info);
});

void window.evp.getState().then(async (state) => {
  vlcDirInput.value = state.vlcDir || '';
  ffmpegPathInput.value = state.ffmpegPath || '';
  applyLoopModeUi(state.playbackMode || 'default');
  currentPath = state.currentPath;
  renderMediaInfo(state.mediaInfo);

  const stored = loadPlaylistFromStorage();
  if (stored && stored.playlist.length > 0) {
    await window.evp.restorePlaylist(stored);
  } else {
    renderPlaylist(state.playlist, currentPath);
  }
});
