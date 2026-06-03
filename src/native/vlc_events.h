#pragma once

#include <napi.h>

#include "libvlc_dynload.h"

void VlcAttachAllPlayerEvents(PlayerState *state);
void VlcDetachAllPlayerEvents(PlayerState *state);
void VlcDispatchPlayerEvent(const libvlc_event_t *event, PlayerState *state);
void VlcClearPlayerEventHandler(int playerId);
void RegisterVlcEventExports(Napi::Env env, Napi::Object exports);
