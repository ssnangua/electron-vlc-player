#include "vlc_media_events.h"
#include "vlc_state.h"

#include "platform_embed.h"
#include "vlc_events.h"

std::mutex g_mutex;
std::map<int, PlayerState> g_players;
int g_next_id = 1;

PlayerState *VlcFindPlayer(int id) {
  auto it = g_players.find(id);
  if (it == g_players.end()) return nullptr;
  return &it->second;
}

bool VlcEnsureMediaPlayer(PlayerState *state, std::string *error) {
  if (!state) {
    if (error) *error = "Invalid player";
    return false;
  }
  if (state->mp) return true;
  if (!g_vlc || !p_libvlc_media_player_new) {
    if (error) *error = "libVLC not initialized";
    return false;
  }
  state->mp = p_libvlc_media_player_new(g_vlc);
  if (!state->mp) {
    if (error) *error = "Failed to create media player";
    return false;
  }
  VlcAttachAllPlayerEvents(state);
  return true;
}

void VlcSyncPlayerDrawable(PlayerState *state) {
  if (!state || !state->mp || !state->child_handle) return;
  PlatformSetBoundsClient(state, state->x, state->y, state->width, state->height);
  if (!state->drawable_attached) {
    AttachDrawable(state->mp, state->child_handle);
    state->drawable_attached = true;
  }
}

void VlcAttachPlayerDrawable(PlayerState *state) {
  VlcSyncPlayerDrawable(state);
}

void VlcReleaseMediaPlayer(PlayerState *state) {
  if (!state) return;
  if (state->mp) {
    VlcDetachAllPlayerEvents(state);
    if (state->drawable_attached) {
      DetachDrawable(state->mp);
      state->drawable_attached = false;
    }
    if (p_libvlc_media_player_stop) p_libvlc_media_player_stop(state->mp);
    if (p_libvlc_media_player_release) p_libvlc_media_player_release(state->mp);
    state->mp = nullptr;
  }
  if (state->media) {
    VlcDetachMediaEvents(state);
    if (p_libvlc_media_release) p_libvlc_media_release(state->media);
    state->media = nullptr;
  }
}
