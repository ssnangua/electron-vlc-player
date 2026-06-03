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
