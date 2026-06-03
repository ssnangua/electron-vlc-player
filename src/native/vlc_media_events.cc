#include "vlc_media_events.h"

#include "vlc_events.h"

static void MediaEventCallback(const libvlc_event_t *event, void *userdata) {
  if (!event || !userdata) return;
  if (event->type == libvlc_MediaParsedChanged) {
    VlcEmitMediaReady(static_cast<PlayerState *>(userdata));
  }
}

void VlcDetachMediaEvents(PlayerState *state) {
  if (!state || !state->media || !state->media_events_attached) return;
  if (!p_libvlc_media_event_manager || !p_libvlc_event_detach) {
    state->media_events_attached = false;
    return;
  }
  libvlc_event_manager_t *em = p_libvlc_media_event_manager(state->media);
  if (em) {
    p_libvlc_event_detach(em, libvlc_MediaParsedChanged, MediaEventCallback, state);
  }
  state->media_events_attached = false;
}

void VlcAttachMediaEvents(PlayerState *state) {
  if (!state || !state->media) return;
  if (!p_libvlc_media_event_manager || !p_libvlc_event_attach) return;

  VlcDetachMediaEvents(state);
  libvlc_event_manager_t *em = p_libvlc_media_event_manager(state->media);
  if (!em) return;

  p_libvlc_event_attach(em, libvlc_MediaParsedChanged, MediaEventCallback, state);
  state->media_events_attached = true;
}

void VlcEmitMediaReady(PlayerState *state) {
  if (!state || !state->media) return;
  if (state->media_ready_signaled) return;
  if (!p_libvlc_media_is_parsed || !p_libvlc_media_is_parsed(state->media)) return;

  state->media_ready_signaled = true;
  libvlc_event_t ev = {};
  ev.type = libvlc_MediaParsedChanged;
  VlcDispatchPlayerEvent(&ev, state);
}
