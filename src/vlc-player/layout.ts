import path from 'node:path';
import { BrowserWindow, screen } from 'electron';
import type { Rectangle, View, WebContents } from 'electron';
import { getBinding } from '../native';
import {
  getNativeHandle,
  PLAYER_CONTAINER_STYLE_ID,
  PLAYER_FS_STYLE_ID,
} from './constants';
import type { VlcPlayerHost } from './host';
import type { ContainerRect } from './types';

export class LayoutController {
  containerRect: ContainerRect = { x: 0, y: 0, width: 1, height: 1 };
  lastNativeBounds: ContainerRect | null = null;
  pageFullscreen = false;
  fullScreen = false;
  savedContainerRect: ContainerRect | null = null;
  savedChromeInsets: { x: number; y: number } | null = null;
  savedMenuBarVisible: boolean | null = null;
  fullscreenExitRecoveryRunning = false;
  cachedChromeInsets: { x: number; y: number } | null = null;
  layoutSyncTimer: NodeJS.Timeout | null = null;

  constructor(private readonly host: VlcPlayerHost) {}

  isPageFullscreen(): boolean {
    return this.pageFullscreen;
  }

  isFullScreen(): boolean {
    return this.fullScreen || this.host.window.isFullScreen();
  }

  /** 页面全屏：容器铺满窗口内容区，不调用 OS 全屏 */
  async setPageFullscreen(on: boolean): Promise<void> {
    if (this.host.destroyed || this.pageFullscreen === on) return;

    this.pageFullscreen = on;
    if (on) {
      this.saveLayoutSnapshotIfNeeded();
      this.lastNativeBounds = null;
      await this.syncContainerExpandedDom(true);
      this.syncMenuBarVisibility();
      this.host.scheduleLayoutSync(true);
    } else {
      await this.syncContainerExpandedDom(false);
      await this.beginFullscreenExitRecovery();
      this.syncMenuBarVisibility();
    }
    this.host.pushState();
  }

  /** 窗口全屏：与 Electron `BrowserWindow.setFullScreen` 一致 */
  async setFullScreen(on: boolean): Promise<void> {
    if (this.host.destroyed) return;
    if (on) {
      if (this.fullScreen && this.host.window.isFullScreen()) return;
      this.fullScreen = true;
      this.saveLayoutSnapshotIfNeeded();
      this.lastNativeBounds = null;
      await this.syncContainerExpandedDom(true);
      this.host.window.setFullScreen(true);
      this.syncMenuBarVisibility();
      return;
    }

    if (!this.fullScreen && !this.host.window.isFullScreen()) return;
    this.fullScreen = false;
    this.host.window.setFullScreen(false);
    this.syncMenuBarVisibility();
    // 恢复逻辑由 leave-full-screen → beginFullscreenExitRecovery 统一处理
  }

  async onWindowEnteredFullScreen(): Promise<void> {
    if (this.fullscreenExitRecoveryRunning) return;
    this.fullScreen = true;
    this.saveLayoutSnapshotIfNeeded();
    this.lastNativeBounds = null;
    await this.syncContainerExpandedDom(true);
    this.syncMenuBarVisibility();
    this.host.scheduleLayoutSync(true);
    this.host.pushState();
  }

  async onWindowLeftFullScreen(): Promise<void> {
    this.fullScreen = false;
    await this.beginFullscreenExitRecovery();
    this.syncMenuBarVisibility();
    this.host.pushState();
  }

  togglePageFullscreen(): void {
    void this.setPageFullscreen(!this.pageFullscreen);
  }

  /** Esc（overlay 侦听）：先退窗口全屏，再退网页全屏 */
  handleEscapeFullscreen(): void {
    if (this.host.destroyed) return;
    if (this.fullScreen || this.host.window.isFullScreen()) {
      void this.setFullScreen(false);
      return;
    }
    if (this.pageFullscreen) {
      void this.setPageFullscreen(false);
    }
  }

  async ensurePlayerReady(): Promise<void> {
    this.containerRect = await this.waitForContainerBounds();
    await this.syncContainerBaseDom();
    if (this.host.playerId < 0) {
      this.host.createPlayerInstance();
    }
    this.cacheChromeInsetsIfValid();
    this.syncLayout();
    this.host.embedLayoutSynced = true;
    void this.installContainerResizeObserver();
    if (this.host.source) {
      setTimeout(() => {
        this.host.scheduleLayoutSync(true);
        this.host.raiseNativeLayer();
      }, 100);
    }
  }

  async waitForContainerBounds(): Promise<ContainerRect> {
    for (let i = 0; i < 40; i++) {
      const measured = await this.measureContainerBounds();
      if (measured && measured.width >= 64 && measured.height >= 64) {
        return measured;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return (await this.measureContainerBounds()) ?? this.containerRect;
  }

  /** 与 overlay 相同：始终用 #stage 的视口矩形（全屏/窗口一致，由 measure 更新） */
  resolveContainerBoundsDip(): ContainerRect {
    return { ...this.containerRect };
  }

  containerRectLooksLikeFullContent(): boolean {
    const [cw, ch] = this.host.window.getContentSize();
    const c = this.containerRect;
    return c.x <= 2 && c.y <= 2 && c.width >= cw - 4 && c.height >= ch - 4;
  }

  /**
   * 退出全屏后 getContentBounds() 常会短暂保持「整屏」尺寸，
   * 导致 overlay / ScreenToClient 仍按全屏布局（截图软件红框铺满显示器）。
   */
  contentBoundsLookStale(win: Rectangle, content: Rectangle): boolean {
    const [cw, ch] = this.host.window.getContentSize();
    return (
      content.width > win.width + 8 ||
      content.height > win.height + 8 ||
      (cw > 0 && content.width > cw + 8)
    );
  }

  resolveContentScreenDip(): Rectangle {
    const win = this.host.window.getBounds();
    const content = this.host.window.getContentBounds();
    const [cw, ch] = this.host.window.getContentSize();

    if (!this.contentBoundsLookStale(win, content)) {
      this.cachedChromeInsets = {
        x: content.x - win.x,
        y: content.y - win.y,
      };
      return content;
    }

    const chrome = this.savedChromeInsets ?? this.cachedChromeInsets ?? { x: 0, y: 0 };
    return {
      x: win.x + chrome.x,
      y: win.y + chrome.y,
      width: cw,
      height: ch,
    };
  }

  /** overlay 子窗口用的屏幕 DIP 坐标（与 #stage 一致） */
  resolveOverlayScreenBounds(): Rectangle {
    const dip = this.resolveContainerBoundsDip();
    const content = this.resolveContentScreenDip();
    return {
      x: content.x + dip.x,
      y: content.y + dip.y,
      width: dip.width,
      height: dip.height,
    };
  }

  resolvePageView(): (View & { webContents?: WebContents }) | null {
    const mainWc = this.host.window.webContents;
    const devtoolsWc = mainWc.devToolsWebContents;
    type PageView = View & { webContents?: WebContents };

    for (const child of this.host.window.contentView.children as PageView[]) {
      if (child.webContents?.id === mainWc.id) return child;
    }

    let best: PageView | null = null;
    let bestArea = 0;
    for (const child of this.host.window.contentView.children as PageView[]) {
      if (!child.webContents || child.webContents === devtoolsWc) continue;
      const b = child.getBounds();
      const area = b.width * b.height;
      if (area > bestArea) {
        bestArea = area;
        best = child;
      }
    }
    return best;
  }

  getDpiScale(): number {
    if (this.host.window.isDestroyed()) return 1;
    return screen.getDisplayMatching(this.host.window.getBounds()).scaleFactor;
  }

  /**
   * Windows：`screen.dipToScreenRect`（DIP → 物理像素）。
   * macOS/Linux：Electron 屏幕 DIP 与原生屏幕坐标一致，直接取整（无 dipToScreenRect API）。
   */
  dipScreenRectToNativeScreen(dipScreen: Rectangle): Rectangle {
    if (process.platform === 'win32') {
      return screen.dipToScreenRect(this.host.window, dipScreen);
    }
    return {
      x: Math.round(dipScreen.x),
      y: Math.round(dipScreen.y),
      width: Math.round(dipScreen.width),
      height: Math.round(dipScreen.height),
    };
  }

  /** macOS NSView 使用点坐标（与 Electron DIP 一致），不用 Windows 的屏幕映射路径。 */
  usesClientNativeBounds(): boolean {
    return process.platform === 'darwin';
  }

  /**
   * 全屏与窗口统一：屏幕 DIP → 原生 setBoundsFromScreen 坐标（仅 Windows 等）。
   * 仅当 getContentBounds 陈旧且无 chrome 缓存时，才退回客户区算法。
   */
  shouldUseNativeScreenMapping(): boolean {
    if (this.usesClientNativeBounds()) return false;
    if (this.host.window.isDestroyed()) return false;
    const win = this.host.window.getBounds();
    const content = this.host.window.getContentBounds();
    if (!this.contentBoundsLookStale(win, content)) return true;
    return (
      (this.savedChromeInsets != null || this.cachedChromeInsets != null) &&
      !this.containerRectLooksLikeFullContent()
    );
  }

  /** 客户区原生坐标（含 WebContentsView 偏移）。macOS 为点/DIP；Windows 为物理像素。 */
  resolveNativeBoundsClientPhysical(): ContainerRect {
    const dip = this.resolveContainerBoundsDip();
    const page = this.resolvePageView()?.getBounds() ?? { x: 0, y: 0 };
    const client = {
      x: Math.round(page.x + dip.x),
      y: Math.round(page.y + dip.y),
      width: Math.round(dip.width),
      height: Math.round(dip.height),
    };
    if (this.usesClientNativeBounds()) return client;
    const scale = this.getDpiScale();
    return {
      x: Math.round(client.x * scale),
      y: Math.round(client.y * scale),
      width: Math.round(client.width * scale),
      height: Math.round(client.height * scale),
    };
  }

  /** 与 overlay 相同的原生屏幕矩形（供 setBoundsFromScreen） */
  resolveNativeBoundsScreenPhysical(): ContainerRect {
    const dipScreen = this.resolveOverlayScreenBounds();
    const physical = this.dipScreenRectToNativeScreen(dipScreen);
    return {
      x: physical.x,
      y: physical.y,
      width: physical.width,
      height: physical.height,
    };
  }

  containerShouldExpandInPage(): boolean {
    return this.pageFullscreen || this.fullScreen;
  }

  shouldHideMenuBar(): boolean {
    if (this.host.window.isDestroyed()) return false;
    // 页面全屏仅放大播放区域，保留菜单栏；窗口/OS 全屏才隐藏
    return this.fullScreen || this.host.window.isFullScreen();
  }

  /** 窗口全屏时隐藏系统菜单栏，退出后恢复 */
  syncMenuBarVisibility(): void {
    if (this.host.window.isDestroyed()) return;
    const hide = this.shouldHideMenuBar();
    if (hide) {
      if (this.savedMenuBarVisible === null) {
        this.savedMenuBarVisible = this.host.window.isMenuBarVisible();
      }
      this.host.window.setMenuBarVisibility(false);
      this.host.window.setAutoHideMenuBar(true);
      return;
    }
    if (this.savedMenuBarVisible !== null) {
      this.host.window.setMenuBarVisibility(this.savedMenuBarVisible);
      this.savedMenuBarVisible = null;
    }
    this.host.window.setAutoHideMenuBar(false);
  }

  saveLayoutSnapshotIfNeeded(): void {
    if (this.savedContainerRect) return;

    this.savedContainerRect = { ...this.containerRect };

    const win = this.host.window.getBounds();
    const content = this.host.window.getContentBounds();
    if (!this.contentBoundsLookStale(win, content)) {
      this.savedChromeInsets = {
        x: content.x - win.x,
        y: content.y - win.y,
      };
    } else {
      this.savedChromeInsets = this.cachedChromeInsets ?? { x: 0, y: 0 };
    }
    this.cachedChromeInsets = { ...this.savedChromeInsets };
  }

  clearLayoutSnapshot(): void {
    this.savedContainerRect = null;
    this.savedChromeInsets = null;
  }

  /** 用进入全屏前保存的容器 + 边框偏移计算屏幕 DIP 矩形（不读滞后的 getContentBounds） */
  resolveOverlayScreenBoundsFromSnapshot(): Rectangle | null {
    if (!this.savedChromeInsets) return null;
    const win = this.host.window.getBounds();
    const dip = this.containerRect;
    const chrome = this.savedChromeInsets;
    return {
      x: win.x + chrome.x + dip.x,
      y: win.y + chrome.y + dip.y,
      width: dip.width,
      height: dip.height,
    };
  }

  /** 按快照直接恢复原生层与 overlay 位置 */
  applyLayoutFromSnapshot(): boolean {
    if (this.host.playerId < 0) return false;

    if (this.usesClientNativeBounds()) {
      const client = this.resolveNativeBoundsClientPhysical();
      getBinding().setBounds(
        this.host.playerId,
        client.x,
        client.y,
        client.width,
        client.height,
      );
      this.lastNativeBounds = client;
    } else {
      const dipScreen = this.resolveOverlayScreenBoundsFromSnapshot();
      if (!dipScreen) return false;
      const physical = this.dipScreenRectToNativeScreen(dipScreen);
      getBinding().setBoundsFromScreen(
        this.host.playerId,
        Math.round(physical.x),
        Math.round(physical.y),
        Math.round(physical.width),
        Math.round(physical.height),
      );
      this.lastNativeBounds = this.resolveNativeBoundsClientPhysical();
    }

    this.host.raiseNativeLayer();
    this.host.overlayWindow.syncOverlayBounds();
    return true;
  }

  /**
   * 退出全屏：用进入前保存的快照直接恢复，再可选地重测 DOM 微调。
   */
  async beginFullscreenExitRecovery(): Promise<void> {
    if (this.fullscreenExitRecoveryRunning || this.host.destroyed) return;

    // 网页全屏仍开启时仅退出 OS 窗口全屏：勿用进入全屏前的容器快照，保持页面内铺满
    if (this.pageFullscreen && !this.fullScreen && !this.host.window.isFullScreen()) {
      this.lastNativeBounds = null;
      await this.syncContainerExpandedDom(true);
      this.syncMenuBarVisibility();
      this.host.scheduleLayoutSync(true);
      this.host.pushState();
      return;
    }

    if (!this.savedContainerRect || !this.savedChromeInsets) {
      this.host.scheduleLayoutSync(true);
      return;
    }

    this.fullscreenExitRecoveryRunning = true;
    try {
      this.lastNativeBounds = null;
      this.containerRect = { ...this.savedContainerRect };

      await this.syncContainerExpandedDom(this.containerShouldExpandInPage());

      if (!this.host.window.isDestroyed() && !this.host.window.webContents.isDestroyed()) {
        await this.host.window.webContents.executeJavaScript('void document.body.offsetHeight');
      }

      if (this.host.playerId >= 0) {
        getBinding().reparentPlayer(this.host.playerId, getNativeHandle(this.host.window));
        this.applyLayoutFromSnapshot();
      }

      this.host.overlayWindow.updateOverlayPresence();

      // DOM 布局稳定后再量一次，与快照对齐
      setTimeout(() => void this.refineLayoutAfterSnapshotRestore(), 150);
    } finally {
      this.fullscreenExitRecoveryRunning = false;
    }
  }

  async refineLayoutAfterSnapshotRestore(): Promise<void> {
    if (
      this.host.destroyed ||
      this.host.window.isDestroyed() ||
      this.host.window.webContents.isDestroyed()
    ) {
      return;
    }
    const measured = await this.measureContainerBounds();
    if (measured) {
      this.containerRect = measured;
    }
    this.cacheChromeInsetsIfValid();
    this.clearLayoutSnapshot();
    this.syncLayout();
  }

  /**
   * 播放容器与窗口背景始终为纯黑，避免 letterbox 透出页面主题色（任意显示模式一致）。
   */
  async syncContainerBaseDom(): Promise<void> {
    if (this.host.window.isDestroyed() || this.host.window.webContents.isDestroyed()) return;

    const containerSel = this.host.containerSelector;
    const styleId = PLAYER_CONTAINER_STYLE_ID;

    await this.host.window.webContents.executeJavaScript(
      `(function () {
        var containerSel = ${JSON.stringify(containerSel)};
        var styleId = ${JSON.stringify(styleId)};
        var css = containerSel + ' { background: #000 !important; }';
        var style = document.getElementById(styleId);
        if (!style) {
          style = document.createElement('style');
          style.id = styleId;
          document.head.appendChild(style);
        }
        style.textContent = css;
      })();`,
    );

    if (!this.host.window.isDestroyed()) {
      this.host.window.setBackgroundColor('#000000');
    }
  }

  /**
   * 注入样式：让 container 铺满视口并隐藏页面其余 UI（播放器全屏 / 页面全屏共用）。
   */
  async syncContainerExpandedDom(enabled: boolean): Promise<void> {
    if (this.host.window.isDestroyed() || this.host.window.webContents.isDestroyed()) return;

    const containerSel = this.host.containerSelector;
    const styleId = PLAYER_FS_STYLE_ID;

    await this.host.window.webContents.executeJavaScript(
      `(function () {
        var containerSel = ${JSON.stringify(containerSel)};
        var styleId = ${JSON.stringify(styleId)};
        var enabled = ${enabled};

        if (!document.getElementById(styleId)) {
          var style = document.createElement('style');
          style.id = styleId;
          style.textContent =
            'body.evp-player-fullscreen { overflow: hidden !important; background: #000 !important; }' +
            'body.evp-player-fullscreen > *:not(' + containerSel + ') {' +
            '  visibility: hidden !important; pointer-events: none !important; }' +
            'body.evp-player-fullscreen ' + containerSel + ' {' +
            '  position: fixed !important; inset: 0 !important;' +
            '  width: 100vw !important; height: 100vh !important;' +
            '  margin: 0 !important; z-index: 2147483646 !important;' +
            '  grid-area: unset !important; max-width: none !important; max-height: none !important;' +
            '  visibility: visible !important; background: #000 !important; }';
          document.head.appendChild(style);
        }

        document.body.classList.toggle('evp-player-fullscreen', enabled);
      })();`,
    );
  }

  /** 客户区原生坐标是否明显超出当前窗口（防止复用全屏缓存） */
  nativeClientBoundsFitContent(bounds: ContainerRect): boolean {
    const [cw, ch] = this.host.window.getContentSize();
    const scale = this.usesClientNativeBounds()
      ? 1
      : screen.getDisplayMatching(this.host.window.getBounds()).scaleFactor;
    const maxW = Math.round(cw * scale) + 16;
    const maxH = Math.round(ch * scale) + 16;
    return (
      bounds.width <= maxW && bounds.height <= maxH && bounds.x <= maxW && bounds.y <= maxH
    );
  }

  async measureContainerBounds(): Promise<ContainerRect | null> {
    if (this.host.window.isDestroyed() || this.host.window.webContents.isDestroyed()) return null;
    const selector = JSON.stringify(this.host.containerSelector);

    try {
      const rect = await this.host.window.webContents.executeJavaScript(
        `new Promise((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const el = document.querySelector(${selector});
              if (!el) return resolve(null);
              const r = el.getBoundingClientRect();
              resolve({
                x: Math.round(r.left),
                y: Math.round(r.top),
                width: Math.round(r.width),
                height: Math.round(r.height),
              });
            });
          });
        })`,
      );
      if (
        rect &&
        typeof rect.x === 'number' &&
        typeof rect.y === 'number' &&
        rect.width > 0 &&
        rect.height > 0
      ) {
        return rect as ContainerRect;
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * 在页面容器上挂 ResizeObserver，尺寸变化时经 `window.evpLayout.notify()` 通知主进程。
   */
  async installContainerResizeObserver(): Promise<void> {
    if (
      this.host.destroyed ||
      this.host.containerResizeObserverInstalled ||
      this.host.window.isDestroyed() ||
      this.host.window.webContents.isDestroyed()
    ) {
      return;
    }

    const selector = JSON.stringify(this.host.containerSelector);
    try {
      const ok = await this.host.window.webContents.executeJavaScript(
        `(function () {
          if (window.__evpLayoutObsInstalled) return true;
          const el = document.querySelector(${selector});
          if (!el) return false;
          const notify = function () {
            if (window.evpLayout && typeof window.evpLayout.notify === 'function') {
              window.evpLayout.notify();
            }
          };
          if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(notify).observe(el);
          }
          notify();
          window.__evpLayoutObsInstalled = true;
          return true;
        })();`,
      );
      if (ok) {
        this.host.containerResizeObserverInstalled = true;
      }
    } catch {
      // 页面未就绪时忽略，did-finish-load / embed 会重试
    }
  }

  scheduleLayoutSync(immediate = false): void {
    if (this.host.destroyed) return;
    if (this.layoutSyncTimer) clearTimeout(this.layoutSyncTimer);
    const delay = immediate ? 0 : 50;
    if (delay === 0) {
      void this.refreshLayoutAndSync();
      return;
    }
    this.layoutSyncTimer = setTimeout(() => {
      this.layoutSyncTimer = null;
      void this.refreshLayoutAndSync();
    }, delay);
  }

  async refreshLayoutAndSync(): Promise<void> {
    if (
      this.host.destroyed ||
      this.host.window.isDestroyed() ||
      this.host.window.webContents.isDestroyed()
    ) {
      return;
    }

    const measured = await this.measureContainerBounds();
    if (measured && !this.containerRectNearlyEqual(this.containerRect, measured)) {
      this.containerRect = measured;
    }

    this.cacheChromeInsetsIfValid();
    this.syncLayout();
  }

  containerRectNearlyEqual(a: ContainerRect, b: ContainerRect): boolean {
    return (
      Math.abs(a.x - b.x) < 1 &&
      Math.abs(a.y - b.y) < 1 &&
      Math.abs(a.width - b.width) < 1 &&
      Math.abs(a.height - b.height) < 1
    );
  }

  cacheChromeInsetsIfValid(): void {
    if (this.host.window.isDestroyed()) return;
    const win = this.host.window.getBounds();
    const content = this.host.window.getContentBounds();
    if (!this.contentBoundsLookStale(win, content)) {
      this.cachedChromeInsets = {
        x: content.x - win.x,
        y: content.y - win.y,
      };
    }
  }

  raiseNativeLayer(): void {
    if (this.host.playerId < 0) return;
    getBinding().raisePlayer(this.host.playerId);
  }

  applyNativeBounds(): boolean {
    if (this.host.playerId < 0) return false;
    const shouldRaise = !!this.host.source;

    const clientProbe = this.resolveNativeBoundsClientPhysical();
    if (clientProbe.width < 64 || clientProbe.height < 64) {
      if (this.lastNativeBounds && this.nativeClientBoundsFitContent(this.lastNativeBounds)) {
        getBinding().setBounds(
          this.host.playerId,
          this.lastNativeBounds.x,
          this.lastNativeBounds.y,
          this.lastNativeBounds.width,
          this.lastNativeBounds.height,
        );
        if (shouldRaise) this.raiseNativeLayer();
        return true;
      }
      return false;
    }

    if (!this.nativeClientBoundsFitContent(clientProbe)) {
      return false;
    }

    const b = getBinding();
    if (this.shouldUseNativeScreenMapping()) {
      const screenBounds = this.resolveNativeBoundsScreenPhysical();
      b.setBoundsFromScreen(
        this.host.playerId,
        screenBounds.x,
        screenBounds.y,
        screenBounds.width,
        screenBounds.height,
      );
      this.lastNativeBounds = clientProbe;
    } else {
      b.setBounds(
        this.host.playerId,
        clientProbe.x,
        clientProbe.y,
        clientProbe.width,
        clientProbe.height,
      );
      this.lastNativeBounds = clientProbe;
    }

    if (shouldRaise) this.raiseNativeLayer();
    return true;
  }

  syncLayout(): void {
    if (this.host.playerId < 0) return;

    this.applyNativeBounds();

    this.host.overlayWindow.syncLayoutOverlay();
  }

  clearLayoutSyncTimer(): void {
    if (this.layoutSyncTimer) {
      clearTimeout(this.layoutSyncTimer);
      this.layoutSyncTimer = null;
    }
  }

  setContainer(container: string): void {
    if (!container?.trim()) return;
    this.host.containerSelector = container;
    this.host.containerResizeObserverInstalled = false;
    if (!this.host.window.isDestroyed() && !this.host.window.webContents.isDestroyed()) {
      void this.host.window.webContents
        .executeJavaScript('window.__evpLayoutObsInstalled = false')
        .catch(() => undefined);
    }
    void this.installContainerResizeObserver();
    void this.syncContainerBaseDom();
    this.scheduleLayoutSync(true);
  }

  createPlayerInstance(): void {
    const hwnd = getNativeHandle(this.host.window);
    const client = this.resolveNativeBoundsClientPhysical();
    this.host.playerId = getBinding().createPlayer(
      hwnd,
      client.x,
      client.y,
      client.width,
      client.height,
    );
    this.applyNativeBounds();

    if (this.host.source) {
      this.host.setSourceDirect(this.host.source, { autoplay: true });
    }

    if (this.host.source && this.host.showControls) {
      this.host.ensureOverlay();
      this.host.scheduleMediaLabelParse();
    }

    this.host.syncPlaybackEndListeners();
    if (this.host.showControls) {
      this.host.attachOverlayStateEvents();
    }
  }

  onMainWindowMoved(): void {
    if (this.host.destroyed) return;
    this.host.overlayWindow.onMainWindowMoved();
  }
}
