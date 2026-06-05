#if defined(__linux__) && !defined(_WIN32)

#include "libvlc_dynload.h"
#include "platform_embed.h"

#include <X11/Xlib.h>
#include <X11/Xutil.h>

#include <algorithm>
#include <cstring>
#include <mutex>

static Display *g_display = nullptr;
static std::once_flag g_display_once;

static Display *GetDisplay() {
  std::call_once(g_display_once, []() { g_display = XOpenDisplay(nullptr); });
  return g_display;
}

static Window BufferToWindow(const uint8_t *buf, size_t len) {
  unsigned long id = 0;
  const size_t copy_len = std::min(len, sizeof(unsigned long));
  if (copy_len == 0) return 0;
  memcpy(&id, buf, copy_len);
  return static_cast<Window>(id);
}

static Window CreateChildWindow(Window parent, int x, int y, int width, int height) {
  Display *display = GetDisplay();
  if (!display || !parent) return 0;
  if (width < 1) width = 1;
  if (height < 1) height = 1;

  XWindowAttributes attrs;
  if (!XGetWindowAttributes(display, parent, &attrs)) return 0;

  const unsigned long mask = CWBackPixel | CWEventMask;
  XSetWindowAttributes swa = {};
  swa.background_pixel = BlackPixel(display, DefaultScreen(display));
  swa.event_mask = ExposureMask | StructureNotifyMask;

  Window child = XCreateWindow(
      display, parent, x, y, static_cast<unsigned>(width), static_cast<unsigned>(height), 0,
      CopyFromParent, InputOutput, CopyFromParent, mask, &swa);
  if (!child) return 0;
  XMapWindow(display, child);
  XRaiseWindow(display, child);
  XFlush(display);
  return child;
}

static void ResizeChildWindow(Window parent, Window child, int x, int y, int width, int height) {
  Display *display = GetDisplay();
  if (!display || !parent || !child) return;
  if (width < 1) width = 1;
  if (height < 1) height = 1;
  XMoveResizeWindow(display, child, x, y, static_cast<unsigned>(width),
                    static_cast<unsigned>(height));
  XRaiseWindow(display, child);
  XFlush(display);
}

static void ResizeChildFromScreen(Window parent, Window child, int screenX, int screenY,
                                  int screenW, int screenH, int *outX, int *outY, int *outW,
                                  int *outH) {
  Display *display = GetDisplay();
  if (!display || !parent || !child) return;
  const Window root = DefaultRootWindow(display);
  int dest_x = 0;
  int dest_y = 0;
  Window child_return = 0;
  XTranslateCoordinates(display, root, parent, screenX, screenY, &dest_x, &dest_y, &child_return);

  int br_x = 0;
  int br_y = 0;
  XTranslateCoordinates(display, root, parent, screenX + screenW, screenY + screenH, &br_x,
                        &br_y, &child_return);
  const int width = br_x - dest_x;
  const int height = br_y - dest_y;
  if (outX) *outX = dest_x;
  if (outY) *outY = dest_y;
  if (outW) *outW = width;
  if (outH) *outH = height;
  ResizeChildWindow(parent, child, dest_x, dest_y, width, height);
}

bool PlatformCreateChild(PlayerState *state, const uint8_t *handle_buf, size_t handle_len,
                         int x, int y, int width, int height) {
  Window parent = BufferToWindow(handle_buf, handle_len);
  if (!parent) return false;
  state->browser_handle = reinterpret_cast<void *>(parent);
  state->x = x;
  state->y = y;
  state->width = width;
  state->height = height;
  Window child = CreateChildWindow(parent, x, y, width, height);
  state->child_handle = reinterpret_cast<void *>(child);
  ResizeChildWindow(parent, child, x, y, width, height);
  return child != 0;
}

void PlatformDestroyChild(PlayerState *state) {
  Display *display = GetDisplay();
  if (!display || !state->child_handle) return;
  XDestroyWindow(display, reinterpret_cast<Window>(state->child_handle));
  XFlush(display);
  state->child_handle = nullptr;
}

void PlatformSetBoundsClient(PlayerState *state, int x, int y, int width, int height) {
  state->x = x;
  state->y = y;
  state->width = width;
  state->height = height;
  ResizeChildWindow(reinterpret_cast<Window>(state->browser_handle),
                    reinterpret_cast<Window>(state->child_handle), x, y, width, height);
}

void PlatformSetBoundsFromScreen(PlayerState *state, int screenX, int screenY, int screenW,
                                 int screenH) {
  ResizeChildFromScreen(reinterpret_cast<Window>(state->browser_handle),
                        reinterpret_cast<Window>(state->child_handle), screenX, screenY, screenW,
                        screenH, &state->x, &state->y, &state->width, &state->height);
}

void PlatformReparent(PlayerState *state, const uint8_t *handle_buf, size_t handle_len) {
  Display *display = GetDisplay();
  Window parent = BufferToWindow(handle_buf, handle_len);
  if (!display || !parent || !state->child_handle) return;
  Window child = reinterpret_cast<Window>(state->child_handle);
  state->browser_handle = reinterpret_cast<void *>(parent);
  XReparentWindow(display, child, parent, state->x, state->y);
  ResizeChildWindow(parent, child, state->x, state->y, state->width, state->height);
}

void PlatformRaise(PlayerState *state) {
  if (!state->child_handle || !state->embed_visible) return;
  ResizeChildWindow(reinterpret_cast<Window>(state->browser_handle),
                    reinterpret_cast<Window>(state->child_handle), state->x, state->y,
                    state->width, state->height);
}

void PlatformSetChildVisible(PlayerState *state, bool visible) {
  Display *display = GetDisplay();
  if (!display || !state || !state->child_handle) return;
  state->embed_visible = visible;
  const Window child = reinterpret_cast<Window>(state->child_handle);
  if (visible) {
    XMapWindow(display, child);
    if (!state->embed_stack_below) {
      XRaiseWindow(display, child);
    }
  } else {
    XUnmapWindow(display, child);
  }
  XFlush(display);
}

void PlatformSetChildStackBelow(PlayerState *state, bool below) {
  if (!state) return;
  state->embed_stack_below = below;
}

void PlatformSetChildOffscreen(PlayerState *state, bool offscreen) {
  if (!state) return;
  state->embed_offscreen = offscreen;
}

bool PlatformIsScreenPointOverWindow(const uint8_t * /*handle_buf*/, size_t /*handle_len*/,
                                     int /*screenX*/, int /*screenY*/) {
  return true;
}

#endif
