const api = window.evp;

const SPEED_OPTIONS = [2, 1.5, 1.25, 1, 0.75, 0.5];
const SLIDER_ACCENT = '#4da3ff';
/** 静音：已调音量段（不透明，与轨道区分） */
const SLIDER_ACCENT_MUTED = '#b4bdc9';
/** 静音：未调音量段 */
const SLIDER_TRACK_MUTED = '#3d444c';
const SLIDER_TRACK = 'rgba(255, 255, 255, 0.25)';
const POPUP_HIDE_DELAY_MS = 280;
const CONTROLS_IDLE_HIDE_MS = 3000;
const TOP_OSD_HIDE_MS = 1000;
const TOP_OSD_FADE_MS = 400;
const VOLUME_WHEEL_STEP = 1;
const VOLUME_KEY_STEP = 10;
const DEFAULT_FRAME_STEP_MS = 42;
/** 与 #seek.evp-range-h 滑块直径一致，用于指针位置 ↔ 时间 与浏览器 range 对齐 */
const SEEK_THUMB_PX = 12;
/** 拖动进度条时节流 seek IPC（ms） */
const SEEK_SCRUB_INTERVAL_MS = 50;

function formatMs(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function formatTimePair(currentMs, totalMs) {
  return `${formatMs(currentMs)} / ${formatMs(totalMs)}`;
}

function volumeIconSrc(level, muted) {
  if (muted) return 'assets/volume-mute.svg';
  if (level <= 0) return 'assets/volume-zero.svg';
  if (level <= 33) return 'assets/volume-low.svg';
  if (level <= 66) return 'assets/volume-middle.svg';
  return 'assets/volume-high.svg';
}

function nearestSpeedOption(rate) {
  let best = SPEED_OPTIONS[0];
  let diff = Math.abs(rate - best);
  for (const r of SPEED_OPTIONS) {
    const d = Math.abs(rate - r);
    if (d < diff) {
      diff = d;
      best = r;
    }
  }
  return best;
}

function formatSpeedLabel(rate) {
  if (rate === 1) return '1.0x';
  if (Number.isInteger(rate)) return `${rate}.0x`;
  return `${rate}x`;
}

function formatSpeedButtonLabel(rate) {
  if (rate === 1) return strings.speedLabel;
  return formatSpeedLabel(rate);
}

const DEFAULT_STRINGS = {
  locale: 'en',
  ...(globalThis.__evpDefaultStrings || {}),
};

const fsTitle = document.getElementById('fs-title');
const fsTitleText = document.getElementById('fs-title-text');
const hitArea = document.getElementById('hit-area');
const btnPrev = document.getElementById('btn-prev');
const btnPlay = document.getElementById('btn-play');
const btnNext = document.getElementById('btn-next');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const timeDisplay = document.getElementById('time-display');
const seek = document.getElementById('seek');
const seekRow = document.querySelector('.controls-row-seek');
const seekPreview = document.getElementById('seek-preview');
const seekPreviewThumb = document.getElementById('seek-preview-thumb');
const seekPreviewTime = document.getElementById('seek-preview-time');
const btnSeekPreview = document.getElementById('btn-seek-preview');

const speedWrap = document.getElementById('speed-wrap');
const btnSpeed = document.getElementById('btn-speed');
const speedMenu = document.getElementById('speed-menu');
const speedButtons = speedMenu.querySelectorAll('button[data-rate]');

const audioWrap = document.getElementById('audio-wrap');
const btnAudio = document.getElementById('btn-audio');
const audioMenu = document.getElementById('audio-menu');

const subtitleWrap = document.getElementById('subtitle-wrap');
const btnSubtitle = document.getElementById('btn-subtitle');
const subtitleMenu = document.getElementById('subtitle-menu');

const volumeWrap = document.getElementById('volume-wrap');
const btnVolume = document.getElementById('btn-volume');
const iconVolume = document.getElementById('icon-volume');
const volumePopup = document.getElementById('volume-popup');
const volumeSlider = document.getElementById('volume-slider');
const volumePopupValue = document.getElementById('volume-popup-value');

const btnPageFs = document.getElementById('btn-page-fs');
const iconEnterPageFs = document.getElementById('icon-enter-page-fs');
const iconLeavePageFs = document.getElementById('icon-leave-page-fs');
const btnWindowFs = document.getElementById('btn-window-fs');
const iconEnterWindowFs = document.getElementById('icon-enter-window-fs');
const iconLeaveWindowFs = document.getElementById('icon-leave-window-fs');
const controlsEl = document.getElementById('controls');
const seekMini = document.getElementById('seek-mini');
const seekMiniFill = document.getElementById('seek-mini-fill');
const topOsd = document.getElementById('top-osd');

let strings = { ...DEFAULT_STRINGS };
let lastOverlayState = null;

function applyStaticStrings() {
  if (strings.locale) document.documentElement.lang = strings.locale;
  hitArea.setAttribute('aria-label', strings.hitAreaLabel);
  seek.setAttribute('aria-label', strings.seekProgressLabel);
  btnPlay.setAttribute('aria-label', strings.playPauseLabel);
  btnPrev.setAttribute('aria-label', strings.previousMediaLabel);
  btnPrev.title = strings.previousMediaLabel;
  btnNext.setAttribute('aria-label', strings.nextMediaLabel);
  btnNext.title = strings.nextMediaLabel;
  btnSeekPreview.setAttribute('aria-label', strings.seekPreviewLabel);
  btnSeekPreview.title = strings.seekPreviewLabel;
  btnAudio.textContent = strings.audioTracksLabel;
  btnSubtitle.textContent = strings.subtitlesLabel;
  btnVolume.setAttribute('aria-label', strings.volumeLabel);
  btnVolume.title = strings.volumeClickToMute;
  volumeSlider.setAttribute('aria-label', strings.volumeLabel);
}

function reapplyDynamicStringsFromState(state) {
  if (!state) return;
  setFullscreenIcons(!!state.pageFullscreen, !!state.fullScreen);
  updatePageFullscreenButtonVisibility(state);
  if (typeof state.rate === 'number') updateSpeedMenu(state.rate);
  if (state.seekPreview) updateSeekPreviewButton(state.seekPreview);
  trackMenuCache.clear();
  if (Array.isArray(state.audioTracks) && typeof state.audioTrackId === 'number') {
    updateTrackMenu(
      audioMenu,
      state.audioTracks,
      state.audioTrackId,
      'audio',
      strings.noAudioTracks,
      (id) => api.setAudioTrack(id),
    );
  }
  if (Array.isArray(state.subtitleTracks) && typeof state.subtitleTrackId === 'number') {
    updateSubtitleMenu(
      subtitleMenu,
      state.subtitleTracks,
      state.subtitleTrackId,
      strings.noSubtitles,
      (id) => api.setSubtitleTrack(id),
    );
  }
}

function applyLocaleStrings(next) {
  strings = { ...DEFAULT_STRINGS, ...next };
  applyStaticStrings();
  reapplyDynamicStringsFromState(lastOverlayState);
}

let lengthMs = 0;
let playbackTimeMs = 0;
let videoFps = 0;
let playing = false;
let seeking = false;
let seekScrubTimer = null;
let lastSeekScrubSentAt = 0;
/** 悬停预览与 scrub seek 共用，仅由 resolveSeekTargetFromPointer 写入 */
let seekUiTargetMs = null;
/** 与主进程 mediaToken 同步；换源时取消 overlay 侧 scrub */
let lastMediaToken = 0;
let hitAreaClickTimer = null;
let volumeLevel = 100;
let volumeMuted = false;
let topOsdHideTimer = null;
let topOsdFadeTimer = null;
const HIT_AREA_SINGLE_CLICK_DELAY_MS = 200;

function applyNoMediaUi() {
  lengthMs = 0;
  playbackTimeMs = 0;
  playing = false;
  videoFps = 0;
  abortSeekScrubLocal();
  hideSeekPreview();
  closeAllOverlayPopups();
  setPlayIcon(false);
  timeDisplay.textContent = formatTimePair(0, 0);
  if (seek) {
    seek.value = '0';
    updateSeekFill();
  }
  updateSeekMiniFill(0, false);
  if (rootEl) rootEl.classList.add('evp-no-media');
}

function applyMediaUi() {
  if (rootEl) rootEl.classList.remove('evp-no-media');
}

function setHorizontalRangeFill(input, percent) {
  const p = Math.min(100, Math.max(0, percent));
  input.style.background = `linear-gradient(to right, ${SLIDER_ACCENT} 0%, ${SLIDER_ACCENT} ${p}%, ${SLIDER_TRACK} ${p}%, ${SLIDER_TRACK} 100%)`;
}

function setVolumeRangeFill(input, percent) {
  const p = Math.min(100, Math.max(0, percent));
  const accent = volumeMuted ? SLIDER_ACCENT_MUTED : SLIDER_ACCENT;
  const track = volumeMuted ? SLIDER_TRACK_MUTED : SLIDER_TRACK;
  input.style.background = `linear-gradient(to right, ${accent} 0%, ${accent} ${p}%, ${track} ${p}%, ${track} 100%)`;
}

/** 静音时调节音量则自动取消静音（UI 即时反馈，libVLC 由 setVolume IPC 处理） */
function ensureAudibleVolumeChange() {
  if (!volumeMuted) return;
  volumeMuted = false;
  updateVolumeMutedAppearance();
  updateVolumeIcon();
}

function updateVolumeMutedAppearance() {
  const muted = !!volumeMuted;
  volumePopup.classList.toggle('evp-volume-muted', muted);
  volumeSlider.classList.toggle('evp-volume-muted', muted);
  setVolumeRangeFill(volumeSlider, Number(volumeSlider.value));
}

let controlsIdleTimer = null;
let pointerInOverlay = false;
let pointerOnControls = false;
let fsTitleFullScreen = false;
let fsTitleMediaLabel = '';
const rootEl = document.getElementById('root');

function isControlsBarVisible() {
  return controlsEl.classList.contains('evp-controls-visible');
}

function updateOverlayCursor() {
  const hideCursor = pointerInOverlay && !isControlsBarVisible();
  document.documentElement.classList.toggle('evp-cursor-hidden', hideCursor);
}

function seekProgressPercent(timeMs, ended) {
  if (lengthMs <= 0) return 0;
  if (ended || timeMs >= lengthMs - 50) return 100;
  return Math.min(100, (timeMs / lengthMs) * 100);
}

function updateSeekMiniFill(timeMs, ended) {
  seekMiniFill.style.width = `${seekProgressPercent(timeMs, ended)}%`;
}

function applySeekMiniVisibility() {
  const show =
    !fsTitleFullScreen && !isControlsBarVisible() && lengthMs > 0;
  seekMini.classList.toggle('evp-seek-mini-visible', show);
  seekMini.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function applyFsTitleVisibility() {
  const show =
    fsTitleFullScreen && fsTitleMediaLabel.length > 0 && isControlsBarVisible();
  fsTitle.classList.toggle('evp-fs-title-visible', show);
  fsTitle.setAttribute('aria-hidden', show ? 'false' : 'true');
  if (fsTitleMediaLabel) {
    fsTitleText.textContent = fsTitleMediaLabel;
  }
  applySeekMiniVisibility();
}

function hideControlsBarNow() {
  if (seeking) return;
  clearTimeout(controlsIdleTimer);
  controlsIdleTimer = null;
  controlsEl.classList.remove('evp-controls-visible');
  updateOverlayCursor();
  applyFsTitleVisibility();
}

function showControlsBar() {
  controlsEl.classList.add('evp-controls-visible');
  updateOverlayCursor();
  applyFsTitleVisibility();
}

function scheduleHideControlsBar() {
  if (pointerOnControls || seeking) return;
  clearTimeout(controlsIdleTimer);
  controlsIdleTimer = setTimeout(() => {
    controlsIdleTimer = null;
    if (pointerOnControls || seeking) return;
    hideControlsBarNow();
  }, CONTROLS_IDLE_HIDE_MS);
}

const OVERLAY_INTERACTIVE_POPUPS = [speedMenu, volumePopup, audioMenu, subtitleMenu];

function isNodeInsideOverlay(node) {
  if (!node || !(node instanceof Node)) return false;
  if (node === document.documentElement || node === document.body) return false;
  if (node === hitArea || hitArea.contains(node)) return true;
  if (node === controlsEl || controlsEl.contains(node)) return true;
  for (const popup of OVERLAY_INTERACTIVE_POPUPS) {
    if (!popup.hidden && (node === popup || popup.contains(node))) return true;
  }
  return false;
}

/** relatedTarget 为空或已离开 overlay 交互区（含可见弹层） */
function shouldTreatPointerAsLeftOverlay(relatedTarget) {
  if (!relatedTarget) return true;
  if (!(relatedTarget instanceof Node)) return true;
  if (!document.documentElement.contains(relatedTarget)) return true;
  return !isNodeInsideOverlay(relatedTarget);
}

function onOverlayPointerActivity() {
  if (!pointerInOverlay) return;
  showControlsBar();
  if (!pointerOnControls) {
    scheduleHideControlsBar();
  }
}

function onControlsPointerEnter() {
  pointerOnControls = true;
  showControlsBar();
  clearTimeout(controlsIdleTimer);
  controlsIdleTimer = null;
}

function onControlsPointerLeave(e) {
  pointerOnControls = false;
  if (shouldTreatPointerAsLeftOverlay(e.relatedTarget)) {
    onPointerLeaveOverlay();
    return;
  }
  if (pointerInOverlay) scheduleHideControlsBar();
}

/** 弹层默认相对按钮水平居中；超出 overlay 左右时仅平移，不改变居中锚点逻辑 */
function clampPopupToViewport(popup) {
  const margin = 8;
  const vw = document.documentElement.clientWidth;
  popup.style.marginLeft = '';
  const rect = popup.getBoundingClientRect();
  let dx = 0;
  if (rect.right > vw - margin) dx = vw - margin - rect.right;
  if (rect.left + dx < margin) dx = margin - rect.left;
  popup.style.marginLeft = dx !== 0 ? `${dx}px` : '';
  clampTrackPopupHeight(popup);
}

/** 弹层向上展开：总高度不得超过视口顶部，避免顶栏+列表被 overlay 裁切 */
function clampTrackPopupHeight(popup) {
  if (!popup.classList.contains('popup-track-menu')) return;
  const margin = 8;
  popup.style.maxHeight = '';
  const bottom = popup.getBoundingClientRect().bottom;
  const maxHeight = Math.max(96, Math.floor(bottom - margin));
  popup.style.maxHeight = `${maxHeight}px`;
  layoutTrackPopupScrollRegion(popup);
}

const TRACK_LIST_MAX_HEIGHT = 240;

/** 为列表区设明确高度（弹层须已显示）；仅在打开/钳制/列表重建时调用，勿在 pushState 轮询里调用 */
function layoutTrackPopupScrollRegion(popup) {
  if (popup.hidden) return;
  const outer = popup.querySelector('.popup-track-scroll-outer');
  const scroll = popup.querySelector('.popup-track-scroll');
  if (!outer || !scroll) return;

  const savedScrollTop = scroll.scrollTop;

  let headerH = 0;
  for (const child of popup.children) {
    if (child === outer) break;
    headerH += child.offsetHeight;
  }

  const margin = 8;
  const popupBottom = popup.getBoundingClientRect().bottom;
  const maxTotal =
    parseFloat(popup.style.maxHeight) || Math.max(96, Math.floor(popupBottom - margin));
  const availList = Math.max(48, Math.min(TRACK_LIST_MAX_HEIGHT, maxTotal - headerH));

  const layoutKey = `${maxTotal}|${headerH}`;
  const prevOuterH = outer.style.height;
  if (prevOuterH && popup.dataset.evpListLayout === layoutKey) {
    scroll.scrollTop = savedScrollTop;
    scroll._evpScrollUpdate?.();
    return;
  }
  popup.dataset.evpListLayout = layoutKey;

  outer.style.height = 'auto';
  scroll.style.maxHeight = 'none';
  const contentH = scroll.scrollHeight;
  const listHeight = Math.min(availList, Math.max(contentH, 1));
  const nextOuterH = `${listHeight}px`;

  outer.style.height = nextOuterH;
  scroll.style.maxHeight = nextOuterH;
  scroll.scrollTop = savedScrollTop;
  scroll._evpScrollUpdate?.();
}

function scheduleClampPopup(popup) {
  requestAnimationFrame(() => {
    clampPopupToViewport(popup);
    requestAnimationFrame(() => {
      clampPopupToViewport(popup);
      popup.querySelectorAll('.popup-track-scroll').forEach((el) => el._evpScrollUpdate?.());
    });
  });
}

function scheduleTrackScrollThumbUpdate(popup) {
  const run = () => {
    if (!popup.hidden) layoutTrackPopupScrollRegion(popup);
    popup.querySelectorAll('.popup-track-scroll').forEach((el) => el._evpScrollUpdate?.());
    refreshTrackMenuTitles(popup);
  };
  requestAnimationFrame(() => {
    run();
    requestAnimationFrame(run);
  });
}

/** @type {Map<HTMLElement, { cancelHide: () => void, hideNow: () => void }>} */
const overlayPopupControllers = new Map();

function hidePopupElement(popup) {
  popup.hidden = true;
  popup.style.marginLeft = '';
  popup.style.maxHeight = '';
  popup.querySelector('.popup-track-scroll-outer')?.style.removeProperty('height');
  popup.querySelector('.popup-track-scroll')?.style.removeProperty('max-height');
  delete popup.dataset.evpListLayout;
}

function closeAllOverlayPopups(exceptPopup = null) {
  for (const popup of OVERLAY_INTERACTIVE_POPUPS) {
    if (popup === exceptPopup || popup.hidden) continue;
    const ctrl = overlayPopupControllers.get(popup);
    ctrl?.hideNow();
  }
}

function bindHoverPopup(wrap, popup, triggerEl, onShow, onHide) {
  let hideTimer = null;

  const cancelHide = () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const hideNow = () => {
    cancelHide();
    if (popup.hidden) return;
    hidePopupElement(popup);
    onHide?.();
  };

  const scheduleHide = () => {
    cancelHide();
    hideTimer = setTimeout(() => {
      hideTimer = null;
      hideNow();
    }, POPUP_HIDE_DELAY_MS);
  };

  overlayPopupControllers.set(popup, { cancelHide, hideNow });

  const show = () => {
    if (seeking) return;
    closeAllOverlayPopups(popup);
    cancelHide();
    popup.hidden = false;
    popup.style.marginLeft = '';
    showControlsBar();
    clearTimeout(controlsIdleTimer);
    onShow?.();
    scheduleClampPopup(popup);
    scheduleTrackScrollThumbUpdate(popup);
  };

  triggerEl.addEventListener('mouseenter', show);
  wrap.addEventListener('mouseleave', (e) => {
    const next = e.relatedTarget;
    if (next && (popup.contains(next) || wrap.contains(next))) return;
    scheduleHide();
  });
  popup.addEventListener('mouseenter', () => {
    cancelHide();
    show();
  });
  popup.addEventListener('mouseleave', (e) => {
    const next = e.relatedTarget;
    if (next && (wrap.contains(next) || popup.contains(next))) return;
    scheduleHide();
  });
}

function setPlayIcon(playing) {
  iconPlay.classList.toggle('hidden', playing);
  iconPause.classList.toggle('hidden', !playing);
}

function setFullscreenIcons(pageFs, windowFs) {
  iconEnterPageFs.classList.toggle('hidden', pageFs);
  iconLeavePageFs.classList.toggle('hidden', !pageFs);
  btnPageFs.setAttribute('aria-label', pageFs ? strings.exitPageFullscreen : strings.pageFullscreen);
  btnPageFs.title = pageFs ? strings.exitPageFullscreen : strings.pageFullscreen;

  iconEnterWindowFs.classList.toggle('hidden', windowFs);
  iconLeaveWindowFs.classList.toggle('hidden', !windowFs);
  btnWindowFs.setAttribute('aria-label', windowFs ? strings.exitWindowFullscreen : strings.windowFullscreen);
  btnWindowFs.title = windowFs ? strings.exitWindowFullscreen : strings.windowFullscreen;
}

function updatePageFullscreenButtonVisibility(state) {
  const featureEnabled = state.showPageFullscreenButton !== false;
  const hide = !featureEnabled || !!state.fullScreen;
  btnPageFs.classList.toggle('evp-nav-hidden', hide);
  btnPageFs.hidden = hide;
}

function updateFsTitle(state) {
  fsTitleFullScreen = !!state.fullScreen;
  if (typeof state.mediaLabel === 'string') {
    fsTitleMediaLabel = state.mediaLabel.trim();
  }
  applyFsTitleVisibility();
}

function showTopOsd(text) {
  if (!topOsd) return;
  topOsd.textContent = text;

  if (topOsdHideTimer) clearTimeout(topOsdHideTimer);
  if (topOsdFadeTimer) clearTimeout(topOsdFadeTimer);

  topOsd.hidden = false;
  topOsd.setAttribute('aria-hidden', 'false');
  topOsd.classList.remove('evp-top-osd-fade');
  topOsd.classList.add('evp-top-osd-visible');

  topOsdHideTimer = setTimeout(() => {
    topOsdHideTimer = null;
    topOsd.classList.remove('evp-top-osd-visible');
    topOsd.classList.add('evp-top-osd-fade');
    topOsdFadeTimer = setTimeout(() => {
      topOsdFadeTimer = null;
      topOsd.classList.remove('evp-top-osd-fade');
      topOsd.hidden = true;
      topOsd.setAttribute('aria-hidden', 'true');
    }, TOP_OSD_FADE_MS);
  }, TOP_OSD_HIDE_MS);
}

function showVolumeOsd(level) {
  const v = Math.max(0, Math.min(100, Math.round(level)));
  showTopOsd(`${strings.volumeLabel} ${v}%`);
}

function showSeekTimeOsd(timeMs) {
  if (lengthMs <= 0) return;
  showTopOsd(formatTimePair(timeMs, lengthMs));
}

function updateVolumeIcon() {
  iconVolume.src = volumeIconSrc(volumeLevel, volumeMuted);
  updateVolumeMutedAppearance();
}

/** 滚轮/快捷键：先算目标音量，OSD 与 setVolume 同步使用同一数值 */
function applyVolumeDelta(delta) {
  ensureAudibleVolumeChange();
  const next = Math.max(0, Math.min(100, Math.round(volumeLevel + delta)));
  volumeLevel = next;
  showVolumeOsd(next);
  api.setVolume(next);
}

function frameStepMs() {
  if (videoFps > 0) return Math.max(1, Math.round(1000 / videoFps));
  return DEFAULT_FRAME_STEP_MS;
}

function seekByDeltaMs(deltaMs) {
  if (!Number.isFinite(deltaMs) || deltaMs === 0) return;
  const base =
    seeking && !playing && seekUiTargetMs != null ? seekUiTargetMs : playbackTimeMs;
  const maxSeek = lengthMs > 0 ? Math.max(0, lengthMs - 50) : Number.MAX_SAFE_INTEGER;
  const next = Math.max(0, Math.min(maxSeek, base + deltaMs));
  showSeekTimeOsd(next);
  api.seekBy(deltaMs);
}

function isRangeInputTarget(target) {
  return target instanceof HTMLInputElement && target.type === 'range';
}

/** 进度/音量条不参与 Tab 焦点；拖完后把焦点还给 hit-area，避免快捷键被 range 吃掉 */
function releaseRangeFocus(el) {
  if (el instanceof HTMLElement) el.blur();
  hitArea.focus({ preventScroll: true });
}

function preventRangeKeyboard(el) {
  el.addEventListener('keydown', (e) => e.preventDefault());
}

function seekRatioFromValue() {
  const max = Number(seek.max) || 1000;
  return Math.min(1, Math.max(0, Number(seek.value) / max));
}

/** 与 Chromium range 滑块中心一致，避免悬停时间比当前播放超前一截 */
function seekRatioFromClientX(clientX) {
  if (!seek) return 0;
  const rect = seek.getBoundingClientRect();
  const w = rect.width || 1;
  const usable = Math.max(1, w - SEEK_THUMB_PX);
  const x = clientX - rect.left - SEEK_THUMB_PX / 2;
  return Math.min(1, Math.max(0, x / usable));
}

function seekMsFromRatio(ratio) {
  if (lengthMs <= 0) return 0;
  const raw = Math.floor(lengthMs * ratio);
  const maxSeek = Math.max(0, lengthMs - 50);
  return Math.min(raw, maxSeek);
}

function msFromSeekSlider() {
  return seekMsFromRatio(seekRatioFromValue());
}

function msFromSeekPointer(clientX) {
  if (lengthMs <= 0 || !seek) return 0;
  return seekMsFromRatio(seekRatioFromClientX(clientX));
}

/** 进度条已播放部分填充比例（0=空、1=满；与播放时间线性对应） */
function seekFillPercentFromRatio(ratio) {
  const r = Math.min(1, Math.max(0, ratio));
  return r * 100;
}

let seekPreviewMeta = null;
const SEEK_PREVIEW_CLAMP_PAD = 4;

/** 唯一入口：从指针 X 计算目标毫秒并写入 seekUiTargetMs */
function resolveSeekTargetFromPointer(clientX) {
  if (lengthMs <= 0 || !seek) {
    seekUiTargetMs = 0;
    return 0;
  }
  seekUiTargetMs = msFromSeekPointer(clientX);
  return seekUiTargetMs;
}

function refreshSeekScrubTimeDisplay() {
  if (!seeking || playing || seekUiTargetMs == null || lengthMs <= 0) return;
  timeDisplay.textContent = formatTimePair(seekUiTargetMs, lengthMs);
  updateSeekMiniFill(seekUiTargetMs, false);
}

function measureSeekPreviewHalfWidth() {
  if (!seekPreview) return 40;
  if (seekPreview.offsetWidth > 0) return seekPreview.offsetWidth / 2;
  let w = 8;
  if (
    seekPreviewMeta?.available &&
    seekPreviewMeta?.spriteUrl &&
    seekPreviewThumb &&
    !seekPreviewThumb.hidden
  ) {
    w = Math.max(w, (seekPreviewMeta.thumbW || 160) + 8);
  }
  w = Math.max(w, 56);
  return w / 2;
}

function positionSeekPreviewAtMs(ms) {
  if (!seekRow || !seekPreview || !seek || lengthMs <= 0) return;
  const ratio = Math.min(1, Math.max(0, ms / lengthMs));
  const rowRect = seekRow.getBoundingClientRect();
  const seekRect = seek.getBoundingClientRect();
  const posPx = SEEK_THUMB_PX / 2 + Math.max(0, seekRect.width - SEEK_THUMB_PX) * ratio;
  let anchorX = seekRect.left - rowRect.left + posPx;

  const halfW = measureSeekPreviewHalfWidth();
  const boundsEl = document.getElementById('root') || seekRow;
  const boundsRect = boundsEl.getBoundingClientRect();
  let centerX = rowRect.left + anchorX;
  const minCenter = boundsRect.left + halfW + SEEK_PREVIEW_CLAMP_PAD;
  const maxCenter = boundsRect.right - halfW - SEEK_PREVIEW_CLAMP_PAD;
  if (maxCenter >= minCenter) {
    centerX = Math.min(maxCenter, Math.max(minCenter, centerX));
  } else {
    centerX = boundsRect.left + boundsRect.width / 2;
  }
  anchorX = centerX - rowRect.left;

  seekPreview.style.left = `${anchorX}px`;
}

function showSeekPreviewAtPointer(clientX) {
  if (lengthMs <= 0) return;
  resolveSeekTargetFromPointer(clientX);
  showSeekPreviewShell();
  refreshSeekScrubTimeDisplay();
}

function resetSeekPreviewThumb() {
  if (!seekPreviewThumb) return;
  seekPreviewThumb.hidden = true;
  seekPreviewThumb.style.backgroundImage = '';
  seekPreviewThumb.style.backgroundSize = '';
  seekPreviewThumb.style.backgroundPosition = '';
}

function applySeekPreviewSprite(ms) {
  if (!seekPreviewThumb || !seekPreviewMeta) {
    resetSeekPreviewThumb();
    return;
  }
  if (
    !seekPreviewMeta.localSource ||
    !seekPreviewMeta.available ||
    !seekPreviewMeta.spriteUrl
  ) {
    resetSeekPreviewThumb();
    return;
  }
  const interval = seekPreviewMeta.intervalMs || 2000;
  const count = seekPreviewMeta.count || 1;
  const cols = seekPreviewMeta.cols || 1;
  const thumbW = seekPreviewMeta.thumbW || 160;
  const thumbH = seekPreviewMeta.thumbH || 90;
  const idx = Math.min(count - 1, Math.max(0, Math.floor(ms / interval)));
  const col = idx % cols;
  const row = Math.floor(idx / cols);
  seekPreviewThumb.style.width = `${thumbW}px`;
  seekPreviewThumb.style.height = `${thumbH}px`;
  seekPreviewThumb.style.backgroundImage = `url("${seekPreviewMeta.spriteUrl}")`;
  seekPreviewThumb.style.backgroundSize = `${cols * thumbW}px auto`;
  seekPreviewThumb.style.backgroundPosition = `-${col * thumbW}px -${row * thumbH}px`;
  seekPreviewThumb.hidden = false;
}

function showSeekPreviewShell() {
  if (!seekPreview || !seekPreviewTime || seekUiTargetMs == null) return;
  seekPreview.removeAttribute('hidden');
  seekPreviewTime.textContent = formatMs(seekUiTargetMs);
  seekPreview.classList.add('evp-visible');
  applySeekPreviewSprite(seekUiTargetMs);
  positionSeekPreviewAtMs(seekUiTargetMs);
}

function hideSeekPreview() {
  seekUiTargetMs = null;
  if (seekPreview) {
    seekPreview.classList.remove('evp-visible');
    seekPreview.setAttribute('hidden', '');
  }
  resetSeekPreviewThumb();
}

function isSeekPreviewActive() {
  return !!seekPreview && seekPreview.classList.contains('evp-visible');
}

function updateSeekPreviewButton(sp) {
  if (!btnSeekPreview || !sp) return;
  const show = sp.canGenerate === true;
  btnSeekPreview.hidden = !show;
  if (!show) return;
  btnSeekPreview.classList.toggle('evp-dim', !sp.available);
  if (sp.generating) {
    btnSeekPreview.disabled = true;
    btnSeekPreview.textContent = `${Math.max(0, Math.min(100, Math.round(sp.percent || 0)))}%`;
  } else {
    btnSeekPreview.disabled = false;
    btnSeekPreview.textContent = strings.seekPreviewGenerate;
  }
}

function onSeekRowPointerMove(e) {
  if (lengthMs <= 0 || seeking) return;
  showSeekPreviewAtPointer(e.clientX);
}

function onSeekRowPointerLeave() {
  if (seeking) return;
  hideSeekPreview();
}

function setSeekScrubbingUi(active) {
  if (seekRow) seekRow.classList.toggle('evp-seek-scrubbing', active);
}

function updateSeekSliderFillOnly() {
  updateSeekFill();
}

function updateSeekPreviewUi(timeMs) {
  timeDisplay.textContent = formatTimePair(timeMs, lengthMs);
  updateSeekFill();
  updateSeekMiniFill(timeMs, false);
}

function syncSeekSliderVisualFromMs(ms) {
  if (lengthMs <= 0 || !seek) return;
  const ratio = Math.min(1, Math.max(0, ms / lengthMs));
  const max = Number(seek.max) || 1000;
  seek.value = String(Math.min(max, Math.max(0, Math.round(ratio * max))));
  setHorizontalRangeFill(seek, seekFillPercentFromRatio(ratio));
}

function scrubSeekAtStoredTarget() {
  if (lengthMs <= 0 || seekUiTargetMs == null) return;
  syncSeekSliderVisualFromMs(seekUiTargetMs);
  api.seekMsScrub(seekUiTargetMs);
  lastSeekScrubSentAt = Date.now();
}

function beginSeekScrubAtClientX(clientX) {
  closeAllOverlayPopups();
  seeking = true;
  setSeekScrubbingUi(true);
  showControlsBar();
  clearTimeout(controlsIdleTimer);
  api.beginSeekScrub();
  showSeekPreviewAtPointer(clientX);
  scrubSeekAtStoredTarget();
}

let seekScrubPointerSession = false;

function onSeekScrubPointerMove(e) {
  if (!seeking) return;
  showSeekPreviewAtPointer(e.clientX);
  scheduleSeekScrub();
}

function detachSeekScrubPointerListeners() {
  if (!seekScrubPointerSession) return;
  seekScrubPointerSession = false;
  window.removeEventListener('pointermove', onSeekScrubPointerMove);
  window.removeEventListener('pointerup', onSeekScrubPointerSessionEnd);
  window.removeEventListener('pointercancel', onSeekScrubPointerSessionEnd);
}

function onSeekScrubPointerSessionEnd() {
  detachSeekScrubPointerListeners();
  finishSeekScrub();
  releaseRangeFocus(seek);
}

function attachSeekScrubPointerListeners() {
  if (seekScrubPointerSession) return;
  seekScrubPointerSession = true;
  window.addEventListener('pointermove', onSeekScrubPointerMove);
  window.addEventListener('pointerup', onSeekScrubPointerSessionEnd);
  window.addEventListener('pointercancel', onSeekScrubPointerSessionEnd);
}

function endSeekScrub() {
  api.endSeekScrub();
}

function finishSeekScrub() {
  if (seekScrubTimer) {
    clearTimeout(seekScrubTimer);
    seekScrubTimer = null;
  }
  if (!seeking) return;
  seeking = false;
  setSeekScrubbingUi(false);
  endSeekScrub();
  if (seekRow && !seekRow.matches(':hover')) hideSeekPreview();
}

/** 换源时本地终止 scrub（不向主进程发 endSeekScrub，主进程已 cancel） */
function abortSeekScrubLocal() {
  if (seekScrubTimer) {
    clearTimeout(seekScrubTimer);
    seekScrubTimer = null;
  }
  detachSeekScrubPointerListeners();
  seeking = false;
  setSeekScrubbingUi(false);
  hideSeekPreview();
}

function scheduleSeekScrub() {
  if (lengthMs <= 0 || seekUiTargetMs == null) return;
  const now = Date.now();
  const elapsed = now - lastSeekScrubSentAt;
  if (elapsed >= SEEK_SCRUB_INTERVAL_MS) {
    if (seekScrubTimer) {
      clearTimeout(seekScrubTimer);
      seekScrubTimer = null;
    }
    scrubSeekAtStoredTarget();
    return;
  }
  if (seekScrubTimer) return;
  seekScrubTimer = setTimeout(() => {
    seekScrubTimer = null;
    scrubSeekAtStoredTarget();
  }, SEEK_SCRUB_INTERVAL_MS - elapsed);
}

function onOverlayWheel(e) {
  if (e.target !== hitArea) return;
  e.preventDefault();
  const delta = e.deltaY < 0 ? VOLUME_WHEEL_STEP : -VOLUME_WHEEL_STEP;
  applyVolumeDelta(delta);
  onOverlayPointerActivity();
}

function onOverlayKeydown(e) {
  if (isRangeInputTarget(e.target)) {
    e.preventDefault();
    releaseRangeFocus(e.target);
  }

  const key = e.key;

  if (key === ' ') {
    e.preventDefault();
    api.togglePause();
    onOverlayPointerActivity();
    return;
  }

  if (key === 't' || key === 'T') {
    e.preventDefault();
    api.togglePageFullscreen();
    return;
  }

  if (key === 'f' || key === 'F') {
    e.preventDefault();
    api.toggleFullScreen();
    return;
  }

  if (key === 'ArrowUp') {
    e.preventDefault();
    applyVolumeDelta(VOLUME_KEY_STEP);
    onOverlayPointerActivity();
    return;
  }

  if (key === 'ArrowDown') {
    e.preventDefault();
    applyVolumeDelta(-VOLUME_KEY_STEP);
    onOverlayPointerActivity();
    return;
  }

  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const sign = key === 'ArrowLeft' ? -1 : 1;
    let deltaMs = 0;
    if (e.altKey && !e.ctrlKey && !e.shiftKey) {
      deltaMs = sign * frameStepMs();
    } else if (e.ctrlKey && !e.altKey && !e.shiftKey) {
      deltaMs = sign * 60000;
    } else if (e.shiftKey && !e.ctrlKey && !e.altKey) {
      deltaMs = sign * 3000;
    } else if (!e.altKey && !e.ctrlKey && !e.shiftKey) {
      deltaMs = sign * 10000;
    } else {
      return;
    }
    e.preventDefault();
    seekByDeltaMs(deltaMs);
    onOverlayPointerActivity();
  }
}

function updateSpeedMenu(rate) {
  const active = nearestSpeedOption(rate);
  for (const btn of speedButtons) {
    const r = Number(btn.dataset.rate);
    const isActive = Math.abs(r - active) < 0.001;
    btn.classList.toggle('active', isActive);
  }
  btnSpeed.textContent = formatSpeedButtonLabel(active);
}

const trackMenuCache = new Map();

/** 仅轨列表内容；选中 id 变化不触发重建，避免滚动条回顶 */
function trackListSignature(tracks) {
  return JSON.stringify(tracks ?? []);
}

function syncTrackMenuActive(menuEl, currentId) {
  for (const btn of menuEl.querySelectorAll('button[data-track-id]')) {
    btn.classList.toggle('active', Number(btn.dataset.trackId) === currentId);
  }
}

function trackListNeedsScroll(scrollEl) {
  return scrollEl.scrollHeight > scrollEl.clientHeight + 1;
}

function updateCustomScrollThumb(scrollEl, trackEl, thumbEl) {
  const needsScroll = trackListNeedsScroll(scrollEl);
  scrollEl.style.overflowY = needsScroll ? 'auto' : 'hidden';
  scrollEl.style.paddingRight = needsScroll ? '6px' : '0';

  if (!needsScroll) {
    trackEl.hidden = true;
    thumbEl.hidden = true;
    thumbEl.style.display = 'none';
    requestAnimationFrame(() => refreshTrackMenuTitles(scrollEl.closest('.popup-menu')));
    return;
  }

  const { scrollHeight, clientHeight, scrollTop } = scrollEl;
  trackEl.hidden = false;
  thumbEl.hidden = false;
  thumbEl.style.display = 'block';
  const viewRatio = clientHeight / scrollHeight;
  const thumbHeight = Math.max(24, Math.round(clientHeight * viewRatio));
  const maxTop = clientHeight - thumbHeight;
  const scrollRatio = scrollTop / (scrollHeight - clientHeight);
  const top = Math.round(maxTop * scrollRatio);
  thumbEl.style.height = `${thumbHeight}px`;
  thumbEl.style.transform = `translateY(${top}px)`;
  requestAnimationFrame(() => refreshTrackMenuTitles(scrollEl.closest('.popup-menu')));
}

function getCustomScrollThumbMetrics(scrollEl) {
  const { scrollHeight, clientHeight } = scrollEl;
  const viewRatio = clientHeight / scrollHeight;
  const thumbHeight = Math.max(24, Math.round(clientHeight * viewRatio));
  const maxTop = Math.max(0, clientHeight - thumbHeight);
  const scrollRange = Math.max(0, scrollHeight - clientHeight);
  return { thumbHeight, maxTop, scrollRange };
}

function scrollThumbToTrackY(scrollEl, trackEl, clientY) {
  const rect = trackEl.getBoundingClientRect();
  const y = clientY - rect.top;
  const { thumbHeight, maxTop, scrollRange } = getCustomScrollThumbMetrics(scrollEl);
  if (scrollRange <= 0) return;
  if (maxTop <= 0) {
    scrollEl.scrollTop = 0;
    return;
  }
  let thumbTop = y - thumbHeight / 2;
  thumbTop = Math.max(0, Math.min(maxTop, thumbTop));
  scrollEl.scrollTop = (thumbTop / maxTop) * scrollRange;
}

function bindCustomScrollbarTrackJump(scrollEl, trackEl, thumbEl) {
  trackEl.addEventListener('mousedown', (e) => {
    if (trackEl.hidden || e.button !== 0) return;
    if (e.target === thumbEl) return;
    e.preventDefault();
    e.stopPropagation();
    scrollThumbToTrackY(scrollEl, trackEl, e.clientY);
    scrollEl._evpScrollUpdate?.();
  });
}

function bindCustomScrollbarDrag(scrollEl, thumbEl) {
  let dragging = false;
  let dragStartY = 0;
  let dragStartScrollTop = 0;

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    thumbEl.classList.remove('evp-scroll-thumb-active');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', endDrag);
  };

  const onMove = (e) => {
    if (!dragging) return;
    const { maxTop, scrollRange } = getCustomScrollThumbMetrics(scrollEl);
    if (maxTop <= 0 || scrollRange <= 0) return;
    const deltaY = e.clientY - dragStartY;
    scrollEl.scrollTop = Math.min(
      scrollRange,
      Math.max(0, dragStartScrollTop + (deltaY / maxTop) * scrollRange),
    );
  };

  thumbEl.addEventListener('mousedown', (e) => {
    if (thumbEl.hidden) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    dragStartY = e.clientY;
    dragStartScrollTop = scrollEl.scrollTop;
    thumbEl.classList.add('evp-scroll-thumb-active');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', endDrag);
  });
}

function bindCustomScrollbar(scrollEl, trackEl, thumbEl) {
  const update = () => updateCustomScrollThumb(scrollEl, trackEl, thumbEl);
  scrollEl.addEventListener('scroll', update, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(update);
    ro.observe(scrollEl);
    scrollEl._evpScrollRo = ro;
  }
  scrollEl._evpScrollUpdate = update;
  bindCustomScrollbarTrackJump(scrollEl, trackEl, thumbEl);
  bindCustomScrollbarDrag(scrollEl, thumbEl);
  update();
}

function createTrackScrollContainer() {
  const outer = document.createElement('div');
  outer.className = 'popup-track-scroll-outer';

  const scroll = document.createElement('div');
  scroll.className = 'popup-track-scroll';

  const track = document.createElement('div');
  track.className = 'evp-scroll-track';
  track.setAttribute('aria-hidden', 'true');
  track.hidden = true;

  const thumb = document.createElement('div');
  thumb.className = 'evp-scroll-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  thumb.hidden = true;

  track.appendChild(thumb);
  outer.appendChild(scroll);
  outer.appendChild(track);
  bindCustomScrollbar(scroll, track, thumb);

  return outer;
}

function getTrackScrollEl(container) {
  return container.querySelector('.popup-track-scroll') || container;
}

function rebuildTrackMenu(menuEl, tracks, currentId, emptyLabel, onSelect) {
  menuEl.replaceChildren();
  const scrollWrap = createTrackScrollContainer();
  menuEl.appendChild(scrollWrap);
  appendTrackMenuItems(getTrackScrollEl(scrollWrap), tracks, currentId, emptyLabel, onSelect);
  getTrackScrollEl(scrollWrap)._evpScrollUpdate?.();
}

function updateTrackMenu(menuEl, tracks, currentId, cacheKey, emptyLabel, onSelect) {
  const listSig = trackListSignature(tracks);
  if (trackMenuCache.get(cacheKey) === listSig) {
    syncTrackMenuActive(menuEl, currentId);
    menuEl.querySelector('.popup-track-scroll')?._evpScrollUpdate?.();
    return;
  }
  const prevScroll = menuEl.querySelector('.popup-track-scroll');
  const scrollTop = prevScroll?.scrollTop ?? 0;
  trackMenuCache.set(cacheKey, listSig);
  rebuildTrackMenu(menuEl, tracks, currentId, emptyLabel, onSelect);
  const scrollEl = menuEl.querySelector('.popup-track-scroll');
  if (!menuEl.hidden) layoutTrackPopupScrollRegion(menuEl);
  if (scrollEl && scrollTop > 0) {
    scrollEl.scrollTop = scrollTop;
    scrollEl._evpScrollUpdate?.();
  }
}

function applyTruncatedTitle(el, text) {
  el.removeAttribute('title');
  requestAnimationFrame(() => {
    if (el.scrollWidth > el.clientWidth) {
      el.title = text;
    }
  });
}

function refreshTrackMenuTitles(root) {
  if (!root) return;
  root.querySelectorAll('button[data-track-id]').forEach((btn) => {
    applyTruncatedTitle(btn, btn.textContent || '');
  });
}

function partitionSubtitleTracks(tracks) {
  let disableTrack = null;
  const playable = [];
  for (const t of tracks || []) {
    if (t.id < 0) disableTrack = t;
    else playable.push(t);
  }
  return { disableTrack, playable };
}

function appendSubtitleMenuHeader(menuEl) {
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.textContent = strings.addSubtitleFile;
  openBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    api.openSubtitle();
  });
  menuEl.appendChild(openBtn);
}

function appendSubtitleDisableOption(menuEl, disableId, currentId, onSelect) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.trackId = String(disableId);
  btn.textContent = strings.disable;
  if (disableId === currentId) btn.classList.add('active');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onSelect(disableId);
  });
  menuEl.appendChild(btn);
}

function appendPopupMenuDivider(menuEl) {
  const divider = document.createElement('div');
  divider.className = 'popup-menu-divider';
  divider.setAttribute('role', 'separator');
  menuEl.appendChild(divider);
}

function appendTrackMenuItems(menuEl, tracks, currentId, emptyLabel, onSelect) {
  if (!tracks || tracks.length === 0) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'popup-menu-empty';
    btn.disabled = true;
    btn.textContent = emptyLabel;
    menuEl.appendChild(btn);
    return;
  }
  for (const t of tracks) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.trackId = String(t.id);
    btn.textContent = t.label;
    if (t.id === currentId) btn.classList.add('active');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelect(t.id);
    });
    menuEl.appendChild(btn);
  }
  const popupRoot = menuEl.closest('.popup-menu');
  requestAnimationFrame(() => refreshTrackMenuTitles(popupRoot));
}

function rebuildSubtitleMenu(menuEl, tracks, currentId, emptyLabel, onSelect) {
  menuEl.replaceChildren();
  appendSubtitleMenuHeader(menuEl);
  const { disableTrack, playable } = partitionSubtitleTracks(tracks);
  if (disableTrack) {
    appendSubtitleDisableOption(menuEl, disableTrack.id, currentId, onSelect);
  }
  appendPopupMenuDivider(menuEl);
  const scrollWrap = createTrackScrollContainer();
  menuEl.appendChild(scrollWrap);
  const scrollEl = getTrackScrollEl(scrollWrap);
  if (playable.length > 0) {
    appendTrackMenuItems(scrollEl, playable, currentId, emptyLabel, onSelect);
  } else if (!disableTrack) {
    appendTrackMenuItems(scrollEl, [], currentId, emptyLabel, onSelect);
  }
  scrollEl._evpScrollUpdate?.();
}

function syncSubtitleMenuActive(menuEl, currentId) {
  for (const btn of menuEl.querySelectorAll('button[data-track-id]')) {
    btn.classList.toggle('active', Number(btn.dataset.trackId) === currentId);
  }
}

function updateSubtitleMenu(menuEl, tracks, currentId, emptyLabel, onSelect) {
  const listSig = trackListSignature(tracks);
  if (trackMenuCache.get('subtitle') === listSig) {
    syncSubtitleMenuActive(menuEl, currentId);
    menuEl.querySelector('.popup-track-scroll')?._evpScrollUpdate?.();
    return;
  }
  const prevScroll = menuEl.querySelector('.popup-track-scroll');
  const scrollTop = prevScroll?.scrollTop ?? 0;
  trackMenuCache.set('subtitle', listSig);
  rebuildSubtitleMenu(menuEl, tracks, currentId, emptyLabel, onSelect);
  const scrollEl = menuEl.querySelector('.popup-track-scroll');
  if (!menuEl.hidden) layoutTrackPopupScrollRegion(menuEl);
  if (scrollEl && scrollTop > 0) {
    scrollEl.scrollTop = scrollTop;
    scrollEl._evpScrollUpdate?.();
  }
}

function updateSeekFill() {
  setHorizontalRangeFill(seek, seekFillPercentFromRatio(seekRatioFromValue()));
}

hitArea.addEventListener('pointerdown', () => {
  hitArea.focus({ preventScroll: true });
});

hitArea.addEventListener('wheel', onOverlayWheel, { passive: false });
document.addEventListener('keydown', onOverlayKeydown, true);

hitArea.addEventListener('click', () => {
  clearTimeout(hitAreaClickTimer);
  hitAreaClickTimer = setTimeout(() => {
    hitAreaClickTimer = null;
    api.togglePause();
  }, HIT_AREA_SINGLE_CLICK_DELAY_MS);
});

hitArea.addEventListener('dblclick', (e) => {
  e.preventDefault();
  clearTimeout(hitAreaClickTimer);
  hitAreaClickTimer = null;
  api.toggleFullScreen();
});

btnPrev.addEventListener('click', (e) => {
  e.stopPropagation();
  api.playPrevious();
});

btnPlay.addEventListener('click', (e) => {
  e.stopPropagation();
  api.togglePause();
});

btnNext.addEventListener('click', (e) => {
  e.stopPropagation();
  api.playNext();
});

btnPageFs.addEventListener('click', (e) => {
  e.stopPropagation();
  api.togglePageFullscreen();
});

btnWindowFs.addEventListener('click', (e) => {
  e.stopPropagation();
  api.toggleFullScreen();
});

bindHoverPopup(
  speedWrap,
  speedMenu,
  btnSpeed,
  () => btnSpeed.setAttribute('aria-expanded', 'true'),
  () => btnSpeed.setAttribute('aria-expanded', 'false'),
);

bindHoverPopup(
  audioWrap,
  audioMenu,
  btnAudio,
  () => btnAudio.setAttribute('aria-expanded', 'true'),
  () => btnAudio.setAttribute('aria-expanded', 'false'),
);

bindHoverPopup(
  subtitleWrap,
  subtitleMenu,
  btnSubtitle,
  () => btnSubtitle.setAttribute('aria-expanded', 'true'),
  () => btnSubtitle.setAttribute('aria-expanded', 'false'),
);

for (const btn of speedButtons) {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const rate = Number(btn.dataset.rate);
    api.setRate(rate);
    updateSpeedMenu(rate);
  });
}

btnVolume.addEventListener('click', (e) => {
  e.stopPropagation();
  api.toggleMute();
});

bindHoverPopup(volumeWrap, volumePopup, btnVolume);

function applyVolumeSliderUi(level) {
  const v = Math.max(0, Math.min(100, Math.round(level)));
  volumeSlider.value = String(v);
  volumePopupValue.textContent = String(v);
  setVolumeRangeFill(volumeSlider, v);
}

volumeSlider.addEventListener('input', (e) => {
  e.stopPropagation();
  ensureAudibleVolumeChange();
  const v = Number(volumeSlider.value);
  applyVolumeSliderUi(v);
  api.setVolume(v);
});

volumeSlider.addEventListener('click', (e) => e.stopPropagation());

preventRangeKeyboard(seek);
preventRangeKeyboard(volumeSlider);

volumeSlider.addEventListener('pointerdown', (e) => e.stopPropagation());
volumeSlider.addEventListener('pointerup', () => releaseRangeFocus(volumeSlider));
volumeSlider.addEventListener('pointercancel', () => releaseRangeFocus(volumeSlider));

seek.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.stopPropagation();
  beginSeekScrubAtClientX(e.clientX);
  attachSeekScrubPointerListeners();
});

seek.addEventListener('input', () => {
  closeAllOverlayPopups();
  seeking = true;
  setSeekScrubbingUi(true);
  showControlsBar();
  seekUiTargetMs = msFromSeekSlider();
  showSeekPreviewShell();
  refreshSeekScrubTimeDisplay();
  scheduleSeekScrub();
});

seek.addEventListener('change', () => {
  onSeekScrubPointerSessionEnd();
});

if (seekRow) {
  seekRow.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || lengthMs <= 0) return;
    if (e.target === seek) return;
    e.preventDefault();
    e.stopPropagation();
    beginSeekScrubAtClientX(e.clientX);
    attachSeekScrubPointerListeners();
  });
  seekRow.addEventListener('mousemove', onSeekRowPointerMove);
  seekRow.addEventListener('mouseleave', onSeekRowPointerLeave);
}

if (btnSeekPreview) {
  btnSeekPreview.addEventListener('click', () => {
    if (!seekPreviewMeta?.canGenerate || seekPreviewMeta?.generating) return;
    api.generateSeekPreview();
  });
}

updateVolumeMutedAppearance();
updateSeekFill();
updateSpeedMenu(1);
applyStaticStrings();
if (api.onStrings) {
  api.onStrings((pack) => applyLocaleStrings(pack));
}

function onContextMenu(e) {
  e.preventDefault();
  e.stopPropagation();
}

document.addEventListener('contextmenu', onContextMenu);
hitArea.addEventListener('contextmenu', onContextMenu);
controlsEl.addEventListener('contextmenu', onContextMenu);

function onPointerEnterOverlay() {
  if (pointerInOverlay) return;
  pointerInOverlay = true;
  updateOverlayCursor();
  hitArea.focus({ preventScroll: true });
}

function onPointerLeaveOverlay() {
  pointerInOverlay = false;
  pointerOnControls = false;
  if (seeking) {
    showControlsBar();
    return;
  }
  hideControlsBarNow();
}

hitArea.addEventListener('mouseenter', onPointerEnterOverlay);
hitArea.addEventListener('mouseleave', (e) => {
  if (shouldTreatPointerAsLeftOverlay(e.relatedTarget)) onPointerLeaveOverlay();
});

rootEl.addEventListener('mouseenter', onPointerEnterOverlay);
rootEl.addEventListener('mouseleave', onPointerLeaveOverlay);
document.documentElement.addEventListener('mouseleave', onPointerLeaveOverlay);

controlsEl.addEventListener('mouseenter', onControlsPointerEnter);
controlsEl.addEventListener('mouseleave', onControlsPointerLeave);

document.addEventListener('mousemove', onOverlayPointerActivity);

api.onState((state) => {
  lastOverlayState = state;
  if (typeof state.mediaToken === 'number' && state.mediaToken !== lastMediaToken) {
    lastMediaToken = state.mediaToken;
    abortSeekScrubLocal();
  }

  if (state.hasMedia === false) {
    applyNoMediaUi();
    return;
  }

  applyMediaUi();
  lengthMs = state.lengthMs || 0;
  const timeMs = state.timeMs || 0;
  playbackTimeMs = timeMs;
  if (typeof state.fps === 'number' && state.fps > 0) {
    videoFps = state.fps;
  }
  playing = !!state.playing;
  // 播放中拖动：第二行显示 libVLC 真实时间；暂停拖动：显示 scrub 目标时间
  const displayTimeMs =
    seeking && !playing && seekUiTargetMs != null ? seekUiTargetMs : timeMs;
  timeDisplay.textContent = formatTimePair(displayTimeMs, lengthMs);
  setPlayIcon(playing);

  if (!seeking && lengthMs > 0) {
    const atEnd = state.ended || timeMs >= lengthMs - 50;
    seek.value = atEnd
      ? '1000'
      : String(Math.min(1000, Math.round((timeMs / lengthMs) * 1000)));
    updateSeekFill();
    updateSeekMiniFill(timeMs, !!state.ended);
  } else if (seeking) {
    updateSeekFill();
    const miniMs =
      !playing && seekUiTargetMs != null ? seekUiTargetMs : timeMs;
    updateSeekMiniFill(miniMs, !!state.ended);
  }

  if (typeof state.volume === 'number') {
    volumeLevel = state.volume;
    applyVolumeSliderUi(state.volume);
  }
  if (typeof state.muted === 'boolean') {
    volumeMuted = state.muted;
  }
  updateVolumeIcon();

  if (typeof state.rate === 'number') {
    updateSpeedMenu(state.rate);
  }

  if (Array.isArray(state.audioTracks) && typeof state.audioTrackId === 'number') {
    updateTrackMenu(
      audioMenu,
      state.audioTracks,
      state.audioTrackId,
      'audio',
      strings.noAudioTracks,
      (id) => api.setAudioTrack(id),
    );
  }
  if (Array.isArray(state.subtitleTracks) && typeof state.subtitleTrackId === 'number') {
    updateSubtitleMenu(
      subtitleMenu,
      state.subtitleTracks,
      state.subtitleTrackId,
      strings.noSubtitles,
      (id) => api.setSubtitleTrack(id),
    );
  }

  setFullscreenIcons(!!state.pageFullscreen, !!state.fullScreen);
  updatePageFullscreenButtonVisibility(state);
  updateFsTitle(state);
  applySeekMiniVisibility();

  if (state.seekPreview) {
    seekPreviewMeta = state.seekPreview;
    updateSeekPreviewButton(state.seekPreview);
    if (isSeekPreviewActive() && seekUiTargetMs != null) {
      positionSeekPreviewAtMs(seekUiTargetMs);
      applySeekPreviewSprite(seekUiTargetMs);
    }
  }

  const showNav = state.playlistEnabled === true;
  btnPrev.classList.toggle('evp-nav-hidden', !showNav);
  btnNext.classList.toggle('evp-nav-hidden', !showNav);
  btnPrev.hidden = !showNav;
  btnNext.hidden = !showNav;
  if (!showNav) {
    return;
  }
  btnPrev.disabled = !state.hasPrevious;
  btnNext.disabled = !state.hasNext;
});
