#ifdef __APPLE__

#import <Cocoa/Cocoa.h>

#include "libvlc_dynload.h"
#include "platform_embed.h"

#include <algorithm>
#include <cstring>

static NSView *BufferToView(const uint8_t *buf, size_t len) {
  uintptr_t ptr = 0;
  const size_t copy_len = std::min(len, sizeof(uintptr_t));
  if (copy_len == 0) return nil;
  memcpy(&ptr, buf, copy_len);
  return reinterpret_cast<NSView *>(ptr);
}

static NSRect ClientRectInParent(NSView *parent, int x, int y, int width, int height) {
  const CGFloat ph = parent.bounds.size.height;
  return NSMakeRect(x, ph - y - height, width, height);
}

static NSView *CreateChildView(NSView *parent, int x, int y, int width, int height) {
  NSView *child = [[NSView alloc] initWithFrame:ClientRectInParent(parent, x, y, width, height)];
  child.wantsLayer = YES;
  child.layer.backgroundColor = NSColor.blackColor.CGColor;
  [parent addSubview:child positioned:NSWindowAbove relativeTo:nil];
  return child;
}

static void ResizeChildView(NSView *parent, NSView *child, int x, int y, int width, int height) {
  if (!parent || !child) return;
  if (width < 1) width = 1;
  if (height < 1) height = 1;
  child.frame = ClientRectInParent(parent, x, y, width, height);
  [parent addSubview:child positioned:NSWindowAbove relativeTo:nil];
  [child setNeedsDisplay:YES];
}

static NSPoint ElectronScreenPointToCocoa(NSPoint electronPoint) {
  NSScreen *primary = [[NSScreen screens] firstObject];
  if (!primary) return electronPoint;
  const CGFloat primaryH = NSHeight([primary frame]);
  return NSMakePoint(electronPoint.x, primaryH - electronPoint.y);
}

/** Electron 屏幕坐标为左上角原点；Cocoa convertRectFromScreen 为左下角原点。 */
static NSRect ElectronScreenRectToCocoa(NSRect electronRect) {
  NSScreen *primary = [[NSScreen screens] firstObject];
  if (!primary) return electronRect;
  const CGFloat primaryH = NSHeight([primary frame]);
  return NSMakeRect(electronRect.origin.x,
                    primaryH - electronRect.origin.y - electronRect.size.height,
                    electronRect.size.width, electronRect.size.height);
}

static void ResizeChildFromScreen(NSView *parent, NSView *child, int screenX, int screenY,
                                  int screenW, int screenH, int *outX, int *outY, int *outW,
                                  int *outH) {
  if (!parent || !child) return;
  NSWindow *window = parent.window;
  if (!window) return;

  const NSRect screenRect = ElectronScreenRectToCocoa(
      NSMakeRect(screenX, screenY, screenW, screenH));
  NSRect windowRect = [window convertRectFromScreen:screenRect];
  NSRect viewRect = [parent convertRect:windowRect fromView:nil];

  const int x = static_cast<int>(viewRect.origin.x);
  const int y = static_cast<int>(parent.bounds.size.height - viewRect.origin.y - viewRect.size.height);
  const int w = static_cast<int>(viewRect.size.width);
  const int h = static_cast<int>(viewRect.size.height);
  if (outX) *outX = x;
  if (outY) *outY = y;
  if (outW) *outW = w;
  if (outH) *outH = h;
  ResizeChildView(parent, child, x, y, w, h);
}

bool PlatformCreateChild(PlayerState *state, const uint8_t *handle_buf, size_t handle_len,
                         int x, int y, int width, int height) {
  NSView *parent = BufferToView(handle_buf, handle_len);
  if (!parent) return false;
  state->browser_handle = parent;
  state->x = x;
  state->y = y;
  state->width = width;
  state->height = height;
  NSView *child = CreateChildView(parent, x, y, width, height);
  state->child_handle = (__bridge_retained void *)child;
  ResizeChildView(parent, child, x, y, width, height);
  return child != nil;
}

void PlatformDestroyChild(PlayerState *state) {
  if (!state->child_handle) return;
  NSView *child = (__bridge_transfer NSView *)state->child_handle;
  [child removeFromSuperview];
  state->child_handle = nullptr;
}

void PlatformSetBoundsClient(PlayerState *state, int x, int y, int width, int height) {
  state->x = x;
  state->y = y;
  state->width = width;
  state->height = height;
  ResizeChildView(static_cast<NSView *>(state->browser_handle),
                  (__bridge NSView *)state->child_handle, x, y, width, height);
}

void PlatformSetBoundsFromScreen(PlayerState *state, int screenX, int screenY, int screenW,
                                 int screenH) {
  ResizeChildFromScreen(static_cast<NSView *>(state->browser_handle),
                        (__bridge NSView *)state->child_handle, screenX, screenY, screenW,
                        screenH, &state->x, &state->y, &state->width, &state->height);
}

void PlatformReparent(PlayerState *state, const uint8_t *handle_buf, size_t handle_len) {
  NSView *parent = BufferToView(handle_buf, handle_len);
  if (!parent || !state->child_handle) return;
  NSView *child = (__bridge NSView *)state->child_handle;
  state->browser_handle = parent;
  [child removeFromSuperview];
  [parent addSubview:child positioned:NSWindowAbove relativeTo:nil];
  ResizeChildView(parent, child, state->x, state->y, state->width, state->height);
}

void PlatformRaise(PlayerState *state) {
  if (!state->child_handle || !state->embed_visible) return;
  ResizeChildView(static_cast<NSView *>(state->browser_handle),
                  (__bridge NSView *)state->child_handle, state->x, state->y, state->width,
                  state->height);
}

void PlatformSetChildVisible(PlayerState *state, bool visible) {
  if (!state || !state->child_handle) return;
  state->embed_visible = visible;
  NSView *child = (__bridge NSView *)state->child_handle;
  [child setHidden:visible ? NO : YES];
}

void PlatformSetChildStackBelow(PlayerState *state, bool below) {
  if (!state) return;
  state->embed_stack_below = below;
}

void PlatformSetChildOffscreen(PlayerState *state, bool offscreen) {
  if (!state) return;
  state->embed_offscreen = offscreen;
}

bool PlatformIsScreenPointOverWindow(const uint8_t *handle_buf, size_t handle_len, int screenX,
                                     int screenY) {
  NSView *view = BufferToView(handle_buf, handle_len);
  if (!view) return false;
  NSWindow *window = view.window;
  if (!window) return false;
  const NSPoint cocoaPoint =
      ElectronScreenPointToCocoa(NSMakePoint(static_cast<CGFloat>(screenX),
                                             static_cast<CGFloat>(screenY)));
  const NSInteger topWindowNumber =
      [NSWindow windowNumberAtPoint:cocoaPoint belowWindowWithWindowNumber:0];
  if (topWindowNumber <= 0) return false;
  return static_cast<NSInteger>(window.windowNumber) == topWindowNumber;
}

#endif
