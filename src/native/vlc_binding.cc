#include <napi.h>

#include <string>
#include <vector>

#include "libvlc_dynload.h"
#include "platform_embed.h"
#include "vlc_events.h"
#include "vlc_media_util.h"
#include "vlc_player_api.h"
#include "vlc_state.h"

static Napi::Array TracksToArray(Napi::Env env, libvlc_track_description_t *head) {
  Napi::Array arr = Napi::Array::New(env);
  uint32_t i = 0;
  for (libvlc_track_description_t *it = head; it; it = it->p_next) {
    Napi::Object item = Napi::Object::New(env);
    item.Set("id", Napi::Number::New(env, it->i_id));
    item.Set("name", Napi::String::New(env, it->psz_name ? it->psz_name : ""));
    arr.Set(i++, item);
  }
  return arr;
}

static PlayerState *GetPlayer(const Napi::CallbackInfo &info, int index = 0) {
  if (info.Length() <= static_cast<size_t>(index) || !info[index].IsNumber()) return nullptr;
  return VlcFindPlayer(info[index].As<Napi::Number>().Int32Value());
}

static Napi::Value Init(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected vlc directory path string").ThrowAsJavaScriptException();
    return env.Null();
  }

  const std::string vlcDirUtf8 = info[0].As<Napi::String>().Utf8Value();
  std::string avcodecHw = g_vlc_avcodec_hw.empty() ? "none" : g_vlc_avcodec_hw;
  if (info.Length() >= 2) {
    if (!info[1].IsString()) {
      Napi::TypeError::New(env, "Expected hardware acceleration mode string")
          .ThrowAsJavaScriptException();
      return env.Null();
    }
    avcodecHw = info[1].As<Napi::String>().Utf8Value();
  }
  const std::string normalizedHw = NormalizeAvcodecHw(avcodecHw);
  if (normalizedHw.empty()) {
    Napi::Error::New(env, "Invalid avcodec-hw value: " + avcodecHw)
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  std::lock_guard<std::mutex> lock(g_mutex);
  if (g_vlc && g_vlc_dir == vlcDirUtf8 && g_vlc_avcodec_hw == normalizedHw) {
    return Napi::Boolean::New(env, true);
  }

  if (!g_players.empty()) {
    Napi::Error::New(env,
                     "Destroy all players before changing libVLC directory or hardware "
                     "acceleration settings")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  if (g_vlc) {
    UnloadLibVlc();
  }

  std::string error;
  if (!LoadLibVlcFromDir(vlcDirUtf8, normalizedHw, &error)) {
    Napi::Error::New(env, error).ThrowAsJavaScriptException();
    return env.Null();
  }

  return Napi::Boolean::New(env, true);
}

static Napi::Value GetHardwareAcceleration(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::lock_guard<std::mutex> lock(g_mutex);
  const std::string hw = g_vlc_avcodec_hw.empty() ? "none" : g_vlc_avcodec_hw;
  return Napi::String::New(env, hw);
}

static Napi::Value CreatePlayer(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!g_vlc) {
    Napi::Error::New(env, "Call init(vlcDir) first").ThrowAsJavaScriptException();
    return env.Null();
  }
  if (info.Length() < 5) {
    Napi::TypeError::New(env, "createPlayer(parentHandle, x, y, width, height)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  auto hwndBuf = info[0].As<Napi::Buffer<uint8_t>>();
  const int x = info[1].As<Napi::Number>().Int32Value();
  const int y = info[2].As<Napi::Number>().Int32Value();
  const int width = info[3].As<Napi::Number>().Int32Value();
  const int height = info[4].As<Napi::Number>().Int32Value();

  std::lock_guard<std::mutex> lock(g_mutex);
  PlayerState state;
  if (!PlatformCreateChild(&state, hwndBuf.Data(), hwndBuf.Length(), x, y, width, height)) {
    Napi::Error::New(env, "Invalid parent window handle").ThrowAsJavaScriptException();
    return env.Null();
  }

  const int id = g_next_id++;
  g_players[id] = state;

  return Napi::Number::New(env, id);
}

static Napi::Value SetMedia(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *state = GetPlayer(info);
  if (!state) {
    Napi::Error::New(env, "Invalid player id").ThrowAsJavaScriptException();
    return env.Null();
  }
  if (info.Length() < 2 || !info[1].IsString()) {
    Napi::TypeError::New(env, "setMedia(id, src, autoplay?)").ThrowAsJavaScriptException();
    return env.Null();
  }

  const std::string src = info[1].As<Napi::String>().Utf8Value();
  const bool autoplay = info.Length() < 3 || !info[2].IsBoolean()
                            ? true
                            : info[2].As<Napi::Boolean>().Value();

  std::string error;
  if (!VlcEnsureMediaPlayer(state, &error)) {
    Napi::Error::New(env, error).ThrowAsJavaScriptException();
    return env.Null();
  }
  if (!VlcLoadMediaIntoPlayer(state, src, {}, &error)) {
    Napi::Error::New(env, error).ThrowAsJavaScriptException();
    return env.Null();
  }

  if (autoplay && state->mp) {
    VlcAttachPlayerDrawable(state);
    p_libvlc_media_player_play(state->mp);
  }
  return Napi::Boolean::New(env, true);
}

static Napi::Value DestroyPlayer(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  const int id = info[0].As<Napi::Number>().Int32Value();
  VlcClearPlayerEventHandler(id);
  std::lock_guard<std::mutex> lock(g_mutex);
  PlayerState *state = VlcFindPlayer(id);
  if (!state) return env.Undefined();
  VlcReleaseMediaPlayer(state);
  PlatformDestroyChild(state);
  state->browser_handle = nullptr;
  g_players.erase(id);
  return env.Undefined();
}

static Napi::Value SetBounds(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *state = GetPlayer(info);
  if (!state || info.Length() < 5) return env.Undefined();
  PlatformSetBoundsClient(state, info[1].As<Napi::Number>().Int32Value(),
                        info[2].As<Napi::Number>().Int32Value(),
                        info[3].As<Napi::Number>().Int32Value(),
                        info[4].As<Napi::Number>().Int32Value());
  if (state->mp) VlcSyncPlayerDrawable(state);
  return env.Undefined();
}

static Napi::Value SetBoundsFromScreen(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *state = GetPlayer(info);
  if (!state || info.Length() < 5) return env.Undefined();
  PlatformSetBoundsFromScreen(state, info[1].As<Napi::Number>().Int32Value(),
                              info[2].As<Napi::Number>().Int32Value(),
                              info[3].As<Napi::Number>().Int32Value(),
                              info[4].As<Napi::Number>().Int32Value());
  if (state->mp) VlcSyncPlayerDrawable(state);
  return env.Undefined();
}

static Napi::Value Play(const Napi::CallbackInfo &info) {
  PlayerState *state = GetPlayer(info);
  if (!state) return info.Env().Undefined();
  libvlc_media_player_t *mp = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!VlcEnsureMediaPlayer(state, nullptr) || !state->mp) return info.Env().Undefined();
    VlcAttachPlayerDrawable(state);
    mp = state->mp;
  }
  if (mp && p_libvlc_media_player_play) p_libvlc_media_player_play(mp);
  return info.Env().Undefined();
}

static Napi::Value Pause(const Napi::CallbackInfo &info) {
  PlayerState *state = GetPlayer(info);
  if (!state || !p_libvlc_media_player_pause) return info.Env().Undefined();
  libvlc_media_player_t *mp = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!state->mp) return info.Env().Undefined();
    mp = state->mp;
  }
  p_libvlc_media_player_pause(mp);
  return info.Env().Undefined();
}

static Napi::Value TogglePause(const Napi::CallbackInfo &info) {
  PlayerState *state = GetPlayer(info);
  if (!state) return info.Env().Undefined();
  libvlc_media_player_t *mp = nullptr;
  bool playing = false;
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!state->mp) return info.Env().Undefined();
    mp = state->mp;
    if (p_libvlc_media_player_is_playing) {
      playing = p_libvlc_media_player_is_playing(mp) != 0;
    }
  }
  if (!mp) return info.Env().Undefined();
  if (playing) {
    if (p_libvlc_media_player_pause) p_libvlc_media_player_pause(mp);
  } else if (p_libvlc_media_player_play) {
    p_libvlc_media_player_play(mp);
  }
  return info.Env().Undefined();
}

static Napi::Value Stop(const Napi::CallbackInfo &info) {
  PlayerState *state = GetPlayer(info);
  if (!state || !p_libvlc_media_player_stop) return info.Env().Undefined();
  libvlc_media_player_t *mp = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!state->mp) return info.Env().Undefined();
    mp = state->mp;
  }
  p_libvlc_media_player_stop(mp);
  return info.Env().Undefined();
}

static Napi::Value IsPlaying(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *state = GetPlayer(info);
  if (!state || !state->mp) return Napi::Boolean::New(env, false);
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::Boolean::New(env, p_libvlc_media_player_is_playing(state->mp) != 0);
}

static Napi::Value GetTime(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *state = GetPlayer(info);
  if (!state || !state->mp) return Napi::Number::New(env, 0);
  std::lock_guard<std::mutex> lock(g_mutex);
  long long t = p_libvlc_media_player_get_time(state->mp);
  if (t < 0) t = state->time_ms;
  return Napi::Number::New(env, static_cast<double>(t));
}

static Napi::Value GetLength(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *state = GetPlayer(info);
  if (!state || !state->mp) return Napi::Number::New(env, 0);
  std::lock_guard<std::mutex> lock(g_mutex);
  long long len = p_libvlc_media_player_get_length(state->mp);
  if (len < 0) len = state->length_ms;
  return Napi::Number::New(env, static_cast<double>(len));
}

static Napi::Value SetTime(const Napi::CallbackInfo &info) {
  PlayerState *state = GetPlayer(info);
  if (!state || info.Length() < 2 || !p_libvlc_media_player_set_time) {
    return info.Env().Undefined();
  }
  const long long t = static_cast<long long>(info[1].As<Napi::Number>().Int64Value());
  libvlc_media_player_t *mp = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!state->mp) return info.Env().Undefined();
    mp = state->mp;
  }
  // set_time 可能同步触发 MediaPlayerTimeChanged；不可在持 g_mutex 时调用（会死锁）
  LibVlcSetPlayerTime(mp, t);
  return info.Env().Undefined();
}

static Napi::Value GetVolume(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *state = GetPlayer(info);
  if (!state || !state->mp || !p_libvlc_audio_get_volume) return Napi::Number::New(env, 100);
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::Number::New(env, p_libvlc_audio_get_volume(state->mp));
}

static Napi::Value SetVolume(const Napi::CallbackInfo &info) {
  PlayerState *state = GetPlayer(info);
  if (!state || !state->mp || info.Length() < 2 || !p_libvlc_audio_set_volume) {
    return info.Env().Undefined();
  }
  std::lock_guard<std::mutex> lock(g_mutex);
  p_libvlc_audio_set_volume(state->mp, info[1].As<Napi::Number>().Int32Value());
  return info.Env().Undefined();
}

static Napi::Value GetAudioTracks(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *state = GetPlayer(info);
  if (!state || !state->mp || !p_libvlc_audio_get_track_description) {
    return Napi::Array::New(env);
  }
  std::lock_guard<std::mutex> lock(g_mutex);
  libvlc_track_description_t *tracks = p_libvlc_audio_get_track_description(state->mp);
  Napi::Array arr = TracksToArray(env, tracks);
  if (tracks) p_libvlc_track_description_list_release(tracks);
  return arr;
}

static Napi::Value GetAudioTrack(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *state = GetPlayer(info);
  if (!state || !state->mp || !p_libvlc_audio_get_track) return Napi::Number::New(env, -1);
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::Number::New(env, p_libvlc_audio_get_track(state->mp));
}

static Napi::Value SetAudioTrack(const Napi::CallbackInfo &info) {
  PlayerState *state = GetPlayer(info);
  if (!state || !state->mp || info.Length() < 2 || !p_libvlc_audio_set_track) {
    return info.Env().Undefined();
  }
  std::lock_guard<std::mutex> lock(g_mutex);
  p_libvlc_audio_set_track(state->mp, info[1].As<Napi::Number>().Int32Value());
  return info.Env().Undefined();
}

static Napi::Value GetSubtitleTracks(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *state = GetPlayer(info);
  if (!state || !state->mp || !p_libvlc_video_get_spu_description) {
    return Napi::Array::New(env);
  }
  std::lock_guard<std::mutex> lock(g_mutex);
  libvlc_track_description_t *tracks = p_libvlc_video_get_spu_description(state->mp);
  Napi::Array arr = TracksToArray(env, tracks);
  if (tracks) p_libvlc_track_description_list_release(tracks);
  return arr;
}

static Napi::Value GetSubtitleTrack(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *state = GetPlayer(info);
  if (!state || !state->mp || !p_libvlc_video_get_spu) return Napi::Number::New(env, -1);
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::Number::New(env, p_libvlc_video_get_spu(state->mp));
}

static Napi::Value SetSubtitleTrack(const Napi::CallbackInfo &info) {
  PlayerState *state = GetPlayer(info);
  if (!state || !state->mp || info.Length() < 2 || !p_libvlc_video_set_spu) {
    return info.Env().Undefined();
  }
  std::lock_guard<std::mutex> lock(g_mutex);
  p_libvlc_video_set_spu(state->mp, info[1].As<Napi::Number>().Int32Value());
  return info.Env().Undefined();
}

static Napi::Value AddSubtitleFile(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *state = GetPlayer(info);
  if (!state || !state->mp || info.Length() < 2 || !p_libvlc_media_player_add_slave) {
    return Napi::Boolean::New(env, false);
  }
  const std::string uri = info[1].As<Napi::String>().Utf8Value();
  if (uri.empty()) return Napi::Boolean::New(env, false);
  std::lock_guard<std::mutex> lock(g_mutex);
  const int ok =
      p_libvlc_media_player_add_slave(state->mp, 0 /* subtitle */, uri.c_str(), 1 /* select */);
  return Napi::Boolean::New(env, ok == 0);
}

static Napi::Value ReparentPlayer(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *state = GetPlayer(info);
  if (!state || info.Length() < 2) return env.Undefined();
  auto buf = info[1].As<Napi::Buffer<uint8_t>>();
  PlatformReparent(state, buf.Data(), buf.Length());
  if (state->mp) {
    state->drawable_attached = false;
    VlcSyncPlayerDrawable(state);
  }
  return env.Undefined();
}

static Napi::Value RaisePlayer(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *state = GetPlayer(info);
  if (!state) return env.Undefined();
  PlatformRaise(state);
  return env.Undefined();
}

static Napi::Value SetPlayerWindowVisible(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *state = GetPlayer(info);
  if (!state || info.Length() < 2) return env.Undefined();
  const bool visible = info[1].As<Napi::Boolean>().Value();
  std::lock_guard<std::mutex> lock(g_mutex);
  PlatformSetChildVisible(state, visible);
  return env.Undefined();
}

static Napi::Value SetPlayerStackBelow(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *state = GetPlayer(info);
  if (!state || info.Length() < 2) return env.Undefined();
  const bool below = info[1].As<Napi::Boolean>().Value();
  std::lock_guard<std::mutex> lock(g_mutex);
  PlatformSetChildStackBelow(state, below);
  return env.Undefined();
}

static Napi::Value SetPlayerOffscreenEmbed(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *state = GetPlayer(info);
  if (!state || info.Length() < 2) return env.Undefined();
  const bool offscreen = info[1].As<Napi::Boolean>().Value();
  std::lock_guard<std::mutex> lock(g_mutex);
  PlatformSetChildOffscreen(state, offscreen);
  return env.Undefined();
}

static Napi::Value IsScreenPointOverWindow(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsBuffer() || !info[1].IsNumber() || !info[2].IsNumber()) {
    Napi::TypeError::New(env, "Expected (handleBuffer, screenX, screenY)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  const auto buf = info[0].As<Napi::Buffer<uint8_t>>();
  const int x = info[1].As<Napi::Number>().Int32Value();
  const int y = info[2].As<Napi::Number>().Int32Value();
  const bool ok = PlatformIsScreenPointOverWindow(buf.Data(), buf.Length(), x, y);
  return Napi::Boolean::New(env, ok);
}

static Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
  exports.Set("init", Napi::Function::New(env, Init));
  exports.Set("getHardwareAcceleration", Napi::Function::New(env, GetHardwareAcceleration));
  exports.Set("createPlayer", Napi::Function::New(env, CreatePlayer));
  exports.Set("setMedia", Napi::Function::New(env, SetMedia));
  exports.Set("destroyPlayer", Napi::Function::New(env, DestroyPlayer));
  exports.Set("setBounds", Napi::Function::New(env, SetBounds));
  exports.Set("setBoundsFromScreen", Napi::Function::New(env, SetBoundsFromScreen));
  exports.Set("reparentPlayer", Napi::Function::New(env, ReparentPlayer));
  exports.Set("raisePlayer", Napi::Function::New(env, RaisePlayer));
  exports.Set("setPlayerWindowVisible", Napi::Function::New(env, SetPlayerWindowVisible));
  exports.Set("setPlayerStackBelow", Napi::Function::New(env, SetPlayerStackBelow));
  exports.Set("setPlayerOffscreenEmbed", Napi::Function::New(env, SetPlayerOffscreenEmbed));
  exports.Set("isScreenPointOverWindow", Napi::Function::New(env, IsScreenPointOverWindow));
  exports.Set("play", Napi::Function::New(env, Play));
  exports.Set("pause", Napi::Function::New(env, Pause));
  exports.Set("togglePause", Napi::Function::New(env, TogglePause));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("isPlaying", Napi::Function::New(env, IsPlaying));
  exports.Set("getTime", Napi::Function::New(env, GetTime));
  exports.Set("getLength", Napi::Function::New(env, GetLength));
  exports.Set("setTime", Napi::Function::New(env, SetTime));
  exports.Set("getVolume", Napi::Function::New(env, GetVolume));
  exports.Set("setVolume", Napi::Function::New(env, SetVolume));
  exports.Set("getAudioTracks", Napi::Function::New(env, GetAudioTracks));
  exports.Set("getAudioTrack", Napi::Function::New(env, GetAudioTrack));
  exports.Set("setAudioTrack", Napi::Function::New(env, SetAudioTrack));
  exports.Set("getSubtitleTracks", Napi::Function::New(env, GetSubtitleTracks));
  exports.Set("getSubtitleTrack", Napi::Function::New(env, GetSubtitleTrack));
  exports.Set("setSubtitleTrack", Napi::Function::New(env, SetSubtitleTrack));
  exports.Set("addSubtitleFile", Napi::Function::New(env, AddSubtitleFile));
  RegisterVlcPlayerApiExports(env, exports);
  RegisterVlcEventExports(env, exports);
  return exports;
}

NODE_API_MODULE(vlc_binding, InitModule)
