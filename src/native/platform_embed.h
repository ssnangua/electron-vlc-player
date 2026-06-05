#pragma once

#include <cstddef>
#include <cstdint>

struct PlayerState;

bool PlatformCreateChild(PlayerState *state, const uint8_t *handle_buf, size_t handle_len,
                         int x, int y, int width, int height);
void PlatformDestroyChild(PlayerState *state);
void PlatformSetBoundsClient(PlayerState *state, int x, int y, int width, int height);
void PlatformSetBoundsFromScreen(PlayerState *state, int screenX, int screenY, int screenW,
                                 int screenH);
void PlatformReparent(PlayerState *state, const uint8_t *handle_buf, size_t handle_len);
void PlatformRaise(PlayerState *state);
void PlatformSetChildVisible(PlayerState *state, bool visible);
void PlatformSetChildStackBelow(PlayerState *state, bool below);
void PlatformSetChildOffscreen(PlayerState *state, bool offscreen);
/** 屏幕坐标点处最前台窗口是否为 handle 对应 NSWindow/HWND（Electron 左上角屏幕坐标） */
bool PlatformIsScreenPointOverWindow(const uint8_t *handle_buf, size_t handle_len, int screenX,
                                     int screenY);
