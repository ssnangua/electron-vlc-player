#include "vlc_events.h"

#include <map>

#include "vlc_state.h"

struct JsEventPayload {
  int playerId = -1;
  int type = 0;
  double timeMs = -1;
  double lengthMs = -1;
  double position = -1;
  /** libvlc_track_type_t；-1 表示无 */
  int trackType = -1;
  int trackId = -1;
};

static std::map<int, Napi::ThreadSafeFunction> g_player_event_tsfn;

static const libvlc_event_e kPlayerEvents[] = {
    libvlc_MediaPlayerTimeChanged,
    libvlc_MediaPlayerPositionChanged,
    libvlc_MediaPlayerLengthChanged,
    libvlc_MediaPlayerEndReached,
    libvlc_MediaPlayerPlaying,
    libvlc_MediaPlayerPaused,
    libvlc_MediaPlayerStopped,
    libvlc_MediaPlayerBuffering,
    libvlc_MediaPlayerEncounteredError,
    libvlc_MediaPlayerESSelected,
};

static void VlcPlayerEventCallback(const libvlc_event_t *event, void *userdata) {
  VlcDispatchPlayerEvent(event, static_cast<PlayerState *>(userdata));
}

void VlcAttachAllPlayerEvents(PlayerState *state) {
  if (!state || !state->mp || !p_libvlc_media_player_event_manager || !p_libvlc_event_attach) {
    return;
  }
  libvlc_event_manager_t *em = p_libvlc_media_player_event_manager(state->mp);
  if (!em) return;
  for (libvlc_event_e ev : kPlayerEvents) {
    p_libvlc_event_attach(em, ev, VlcPlayerEventCallback, state);
  }
}

void VlcDetachAllPlayerEvents(PlayerState *state) {
  if (!state || !state->mp || !p_libvlc_media_player_event_manager || !p_libvlc_event_detach) {
    return;
  }
  libvlc_event_manager_t *em = p_libvlc_media_player_event_manager(state->mp);
  if (!em) return;
  for (libvlc_event_e ev : kPlayerEvents) {
    p_libvlc_event_detach(em, ev, VlcPlayerEventCallback, state);
  }
}

static void EnrichPayload(const libvlc_event_t *event, JsEventPayload *payload, PlayerState *state) {
  if (!payload || !state || !state->mp) return;
  switch (payload->type) {
    case libvlc_MediaPlayerTimeChanged:
      if (event->u.media_player_time_changed.new_time >= 0) {
        payload->timeMs = static_cast<double>(event->u.media_player_time_changed.new_time);
      } else {
        payload->timeMs = static_cast<double>(state->time_ms);
      }
      break;
    case libvlc_MediaPlayerPositionChanged:
      payload->position = event->u.media_player_position_changed.new_position;
      if (state->length_ms > 0 && payload->position >= 0.f) {
        payload->timeMs =
            static_cast<double>(payload->position * static_cast<double>(state->length_ms));
      } else if (state->time_ms >= 0) {
        payload->timeMs = static_cast<double>(state->time_ms);
      }
      break;
    case libvlc_MediaPlayerLengthChanged:
      if (event->u.media_player_length_changed.new_length > 0) {
        payload->lengthMs = static_cast<double>(event->u.media_player_length_changed.new_length);
      } else {
        payload->lengthMs = static_cast<double>(state->length_ms);
      }
      break;
    case libvlc_MediaPlayerESSelected: {
      const libvlc_track_type_t trackType = event->u.media_player_es_changed.i_type;
      payload->trackType = static_cast<int>(trackType);
      if (trackType == libvlc_track_video && p_libvlc_video_get_track) {
        payload->trackId = p_libvlc_video_get_track(state->mp);
      } else if (trackType == libvlc_track_audio && p_libvlc_audio_get_track) {
        payload->trackId = p_libvlc_audio_get_track(state->mp);
      } else if (trackType == libvlc_track_text && p_libvlc_video_get_spu) {
        payload->trackId = p_libvlc_video_get_spu(state->mp);
      }
      break;
    }
    default:
      break;
  }
}

void VlcDispatchPlayerEvent(const libvlc_event_t *event, PlayerState *state) {
  if (!event || !state) return;

  int playerId = -1;
  Napi::ThreadSafeFunction tsfn;
  auto *payload = new JsEventPayload();

  {
    std::lock_guard<std::mutex> lock(g_mutex);
    OnVlcEvent(event, state);
    for (const auto &entry : g_players) {
      if (&entry.second == state) {
        playerId = entry.first;
        break;
      }
    }
    if (playerId < 0) {
      delete payload;
      return;
    }
    auto it = g_player_event_tsfn.find(playerId);
    if (it == g_player_event_tsfn.end()) {
      delete payload;
      return;
    }
    tsfn = it->second;
    payload->playerId = playerId;
    payload->type = event->type;
    EnrichPayload(event, payload, state);
  }

  tsfn.NonBlockingCall(payload, [](Napi::Env env, Napi::Function jsCallback, JsEventPayload *data) {
    Napi::HandleScope scope(env);
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("type", Napi::Number::New(env, data->type));
    if (data->timeMs >= 0) obj.Set("time", Napi::Number::New(env, data->timeMs));
    if (data->lengthMs >= 0) obj.Set("length", Napi::Number::New(env, data->lengthMs));
    if (data->position >= 0) obj.Set("position", Napi::Number::New(env, data->position));
    if (data->trackType >= 0) obj.Set("trackType", Napi::Number::New(env, data->trackType));
    if (data->trackId >= -1) obj.Set("trackId", Napi::Number::New(env, data->trackId));
    jsCallback.Call({obj});
    if (env.IsExceptionPending()) {
      napi_value stored = nullptr;
      napi_get_and_clear_last_exception(env, &stored);
    }
    delete data;
  });
}

static void VlcClearPlayerEventHandlerLocked(int playerId) {
  auto it = g_player_event_tsfn.find(playerId);
  if (it == g_player_event_tsfn.end()) return;
  it->second.Release();
  g_player_event_tsfn.erase(it);
}

void VlcClearPlayerEventHandler(int playerId) {
  std::lock_guard<std::mutex> lock(g_mutex);
  VlcClearPlayerEventHandlerLocked(playerId);
}

static Napi::Value SetPlayerEventHandler(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "setPlayerEventHandler(playerId, callback?)").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const int playerId = info[0].As<Napi::Number>().Int32Value();
  std::lock_guard<std::mutex> lock(g_mutex);
  if (!VlcFindPlayer(playerId)) {
    Napi::Error::New(env, "Invalid player id").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  VlcClearPlayerEventHandlerLocked(playerId);

  if (info.Length() < 2 || info[1].IsNull() || info[1].IsUndefined()) {
    return env.Undefined();
  }
  if (!info[1].IsFunction()) {
    Napi::TypeError::New(env, "callback must be a function").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Function callback = info[1].As<Napi::Function>();
  g_player_event_tsfn[playerId] = Napi::ThreadSafeFunction::New(
      env, callback, "electron_vlc_player_event", 0, 1);
  return env.Undefined();
}

void RegisterVlcEventExports(Napi::Env env, Napi::Object exports) {
  exports.Set("setPlayerEventHandler", Napi::Function::New(env, SetPlayerEventHandler));
}
