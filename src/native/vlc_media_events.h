#pragma once

#include "libvlc_dynload.h"

void VlcAttachMediaEvents(PlayerState *state);
void VlcDetachMediaEvents(PlayerState *state);
/** libvlc_media_is_parsed 为真时向 JS 投递 MediaParsedChanged（供 parseMedia Promise，每段 media 一次） */
void VlcEmitMediaReady(PlayerState *state);
