#ifdef _WIN32

#include "libvlc_dynload.h"
#include "platform_embed.h"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <algorithm>
#include <cstring>

static bool g_window_class_registered = false;

static LRESULT CALLBACK VlcChildWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  return DefWindowProcW(hwnd, msg, wParam, lParam);
}

static void EnsureWindowClass() {
  if (g_window_class_registered) return;
  WNDCLASSEXW wc = {};
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = VlcChildWndProc;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = L"ElectronVlcPlayerChild";
  wc.hbrBackground = (HBRUSH)GetStockObject(BLACK_BRUSH);
  RegisterClassExW(&wc);
  g_window_class_registered = true;
}

static HWND BufferToHwnd(const uint8_t *buf, size_t len) {
  uintptr_t handle = 0;
  const size_t copy_len = std::min(len, sizeof(uintptr_t));
  if (copy_len == 0) return nullptr;
  memcpy(&handle, buf, copy_len);
  return reinterpret_cast<HWND>(handle);
}

static HWND CreateChildHwnd(HWND parent, int x, int y, int width, int height) {
  EnsureWindowClass();
  return CreateWindowExW(
      WS_EX_NOPARENTNOTIFY,
      L"ElectronVlcPlayerChild",
      L"",
      WS_CHILD | WS_VISIBLE,
      x, y, width, height,
      parent,
      nullptr,
      GetModuleHandleW(nullptr),
      nullptr);
}

static void ClampBoundsToParent(HWND parent, int &x, int &y, int &width, int &height) {
  RECT rc = {};
  GetClientRect(parent, &rc);
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  const int maxW = rc.right - x;
  const int maxH = rc.bottom - y;
  if (maxW < 1 || maxH < 1) return;
  if (width > maxW) width = maxW;
  if (height > maxH) height = maxH;
}

static bool IsValidHwnd(HWND hwnd) {
  return hwnd != nullptr && IsWindow(hwnd) != 0;
}

static void RaiseAboveWebContent(HWND browser, HWND child) {
  if (!IsValidHwnd(child) || !IsValidHwnd(browser)) return;
  SetWindowPos(child, HWND_TOP, 0, 0, 0, 0,
               SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
}

static void ResizeChildHwnd(HWND browser, HWND hwnd, int x, int y, int width, int height,
                            bool visible, bool stackBelow, bool offscreen) {
  if (!IsValidHwnd(hwnd) || !IsValidHwnd(browser)) return;
  if (width < 1) width = 1;
  if (height < 1) height = 1;
  if (!offscreen) {
    ClampBoundsToParent(browser, x, y, width, height);
  }
  const HWND insertAfter = stackBelow ? HWND_BOTTOM : HWND_TOP;
  const UINT flags = SWP_NOACTIVATE | (visible ? SWP_SHOWWINDOW : SWP_HIDEWINDOW);
  SetWindowPos(hwnd, insertAfter, x, y, width, height, flags);
  ShowWindow(hwnd, visible ? SW_SHOW : SW_HIDE);
  // 仅主 player 可提到 TOP；预览窗切勿 RaiseAboveWebContent
  if (visible && !stackBelow) {
    RaiseAboveWebContent(browser, hwnd);
    UpdateWindow(hwnd);
    InvalidateRect(hwnd, nullptr, TRUE);
  }
}

static void ResizeChildHwndFromScreen(HWND browser, HWND hwnd, int screenX, int screenY,
                                      int screenW, int screenH, bool visible, bool stackBelow,
                                      bool offscreen, int *outX, int *outY, int *outW, int *outH) {
  if (!IsValidHwnd(hwnd) || !IsValidHwnd(browser)) return;
  POINT tl = {screenX, screenY};
  POINT br = {screenX + screenW, screenY + screenH};
  ScreenToClient(browser, &tl);
  ScreenToClient(browser, &br);
  int x = tl.x;
  int y = tl.y;
  int width = br.x - tl.x;
  int height = br.y - tl.y;
  if (outX) *outX = x;
  if (outY) *outY = y;
  if (outW) *outW = width;
  if (outH) *outH = height;
  ResizeChildHwnd(browser, hwnd, x, y, width, height, visible, stackBelow, offscreen);
}

bool PlatformCreateChild(PlayerState *state, const uint8_t *handle_buf, size_t handle_len,
                         int x, int y, int width, int height) {
  HWND browser = BufferToHwnd(handle_buf, handle_len);
  if (!browser) return false;
  state->browser_handle = browser;
  state->x = x;
  state->y = y;
  state->width = width;
  state->height = height;
  state->child_handle = CreateChildHwnd(browser, x, y, width, height);
  ResizeChildHwnd(browser, static_cast<HWND>(state->child_handle), x, y, width, height,
                  state->embed_visible, state->embed_stack_below, state->embed_offscreen);
  return state->child_handle != nullptr;
}

void PlatformDestroyChild(PlayerState *state) {
  if (state->child_handle) {
    DestroyWindow(static_cast<HWND>(state->child_handle));
    state->child_handle = nullptr;
  }
}

void PlatformSetBoundsClient(PlayerState *state, int x, int y, int width, int height) {
  state->x = x;
  state->y = y;
  state->width = width;
  state->height = height;
  ResizeChildHwnd(static_cast<HWND>(state->browser_handle),
                  static_cast<HWND>(state->child_handle), x, y, width, height,
                  state->embed_visible, state->embed_stack_below, state->embed_offscreen);
}

void PlatformSetBoundsFromScreen(PlayerState *state, int screenX, int screenY, int screenW,
                                 int screenH) {
  ResizeChildHwndFromScreen(static_cast<HWND>(state->browser_handle),
                            static_cast<HWND>(state->child_handle), screenX, screenY, screenW,
                            screenH, state->embed_visible, state->embed_stack_below,
                            state->embed_offscreen, &state->x, &state->y, &state->width,
                            &state->height);
}

void PlatformReparent(PlayerState *state, const uint8_t *handle_buf, size_t handle_len) {
  HWND browser = BufferToHwnd(handle_buf, handle_len);
  if (!IsValidHwnd(browser) || !state->child_handle) return;
  state->browser_handle = browser;
  SetParent(static_cast<HWND>(state->child_handle), browser);
  ResizeChildHwnd(browser, static_cast<HWND>(state->child_handle), state->x, state->y,
                  state->width, state->height, state->embed_visible, state->embed_stack_below,
                  state->embed_offscreen);
}

void PlatformSetChildVisible(PlayerState *state, bool visible) {
  if (!state || !state->child_handle) return;
  state->embed_visible = visible;
  HWND browser = static_cast<HWND>(state->browser_handle);
  HWND child = static_cast<HWND>(state->child_handle);
  ResizeChildHwnd(browser, child, state->x, state->y, state->width, state->height,
                  state->embed_visible, state->embed_stack_below, state->embed_offscreen);
}

void PlatformSetChildStackBelow(PlayerState *state, bool below) {
  if (!state || !state->child_handle) return;
  state->embed_stack_below = below;
  HWND browser = static_cast<HWND>(state->browser_handle);
  HWND child = static_cast<HWND>(state->child_handle);
  ResizeChildHwnd(browser, child, state->x, state->y, state->width, state->height,
                  state->embed_visible, state->embed_stack_below, state->embed_offscreen);
}

void PlatformSetChildOffscreen(PlayerState *state, bool offscreen) {
  if (!state) return;
  state->embed_offscreen = offscreen;
  if (!state->child_handle) return;
  HWND browser = static_cast<HWND>(state->browser_handle);
  HWND child = static_cast<HWND>(state->child_handle);
  ResizeChildHwnd(browser, child, state->x, state->y, state->width, state->height,
                  state->embed_visible, state->embed_stack_below, state->embed_offscreen);
}

void PlatformRaise(PlayerState *state) {
  HWND browser = static_cast<HWND>(state->browser_handle);
  HWND child = static_cast<HWND>(state->child_handle);
  if (!IsValidHwnd(child) || !IsValidHwnd(browser)) return;
  if (!state->embed_visible || state->embed_stack_below) return;
  // 仅提升 Z 序；重复 SetWindowPos+InvalidateRect 会在 Electron 重绘时触发崩溃
  RaiseAboveWebContent(browser, child);
}

#endif
