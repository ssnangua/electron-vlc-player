#include "vlc_player_api.h"

#include <vector>

#include "libvlc_dynload.h"
#include "vlc_media_info.h"
#include "vlc_media_util.h"
#include "vlc_state.h"

static PlayerState *GetPlayerArg(const Napi::CallbackInfo &info, int index = 0) {
  if (info.Length() <= static_cast<size_t>(index) || !info[index].IsNumber()) return nullptr;
  return VlcFindPlayer(info[index].As<Napi::Number>().Int32Value());
}

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

static std::string TakeLibVlcString(char *s) {
  if (!s) return "";
  std::string out(s);
  if (p_libvlc_free) p_libvlc_free(s);
  return out;
}

static std::vector<std::string> ParseStringArray(Napi::Env env, const Napi::Value &val) {
  std::vector<std::string> out;
  if (!val.IsArray()) return out;
  Napi::Array arr = val.As<Napi::Array>();
  for (uint32_t i = 0; i < arr.Length(); i++) {
    Napi::Value item = arr.Get(i);
    if (item.IsString()) out.push_back(item.As<Napi::String>().Utf8Value());
  }
  return out;
}

static Napi::Value GetLibVlcVersion(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  Napi::Object o = Napi::Object::New(env);
  o.Set("version", Napi::String::New(env, p_libvlc_get_version ? p_libvlc_get_version() : ""));
  o.Set("compiler", Napi::String::New(env, p_libvlc_get_compiler ? p_libvlc_get_compiler() : ""));
  o.Set("changeset", Napi::String::New(env, p_libvlc_get_changeset ? p_libvlc_get_changeset() : ""));
  return o;
}

static Napi::Value GetState(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || !p_libvlc_media_player_get_state) return Napi::Number::New(env, 0);
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::Number::New(env, static_cast<int>(p_libvlc_media_player_get_state(s->mp)));
}

static Napi::Value BoolPlayerApi(const Napi::CallbackInfo &info, int (*fn)(libvlc_media_player_t *)) {
  Napi::Env env = info.Env();
  if (!fn) return Napi::Boolean::New(env, false);
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp) return Napi::Boolean::New(env, false);
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::Boolean::New(env, fn(s->mp) != 0);
}

static Napi::Value WillPlay(const Napi::CallbackInfo &info) {
  return BoolPlayerApi(info, p_libvlc_media_player_will_play);
}
static Napi::Value CanPause(const Napi::CallbackInfo &info) {
  return BoolPlayerApi(info, p_libvlc_media_player_can_pause);
}
static Napi::Value IsPaused(const Napi::CallbackInfo &info) {
  return BoolPlayerApi(info, p_libvlc_media_player_is_paused);
}
static Napi::Value IsSeekable(const Napi::CallbackInfo &info) {
  return BoolPlayerApi(info, p_libvlc_media_player_is_seekable);
}
static Napi::Value HasVout(const Napi::CallbackInfo &info) {
  return BoolPlayerApi(info, p_libvlc_media_player_has_vout);
}

static Napi::Value SetPause(const Napi::CallbackInfo &info) {
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || info.Length() < 2 || !p_libvlc_media_player_set_pause) return info.Env().Undefined();
  const bool paused = info[1].As<Napi::Boolean>().Value();
  std::lock_guard<std::mutex> lock(g_mutex);
  p_libvlc_media_player_set_pause(s->mp, paused ? 1 : 0);
  return info.Env().Undefined();
}

static Napi::Value GetPosition(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || !p_libvlc_media_player_get_position) return Napi::Number::New(env, 0);
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::Number::New(env, p_libvlc_media_player_get_position(s->mp));
}

static Napi::Value SetPosition(const Napi::CallbackInfo &info) {
  PlayerState *s = GetPlayerArg(info);
  if (!s || info.Length() < 2 || !p_libvlc_media_player_set_position) return info.Env().Undefined();
  const float pos = static_cast<float>(info[1].As<Napi::Number>().DoubleValue());
  libvlc_media_player_t *mp = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!s->mp) return info.Env().Undefined();
    mp = s->mp;
  }
  LibVlcSetPlayerPosition(mp, pos);
  return info.Env().Undefined();
}

static Napi::Value GetRate(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || !p_libvlc_media_player_get_rate) return Napi::Number::New(env, 1);
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::Number::New(env, p_libvlc_media_player_get_rate(s->mp));
}

static Napi::Value SetRate(const Napi::CallbackInfo &info) {
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || info.Length() < 2 || !p_libvlc_media_player_set_rate) return info.Env().Undefined();
  std::lock_guard<std::mutex> lock(g_mutex);
  p_libvlc_media_player_set_rate(s->mp, static_cast<float>(info[1].As<Napi::Number>().DoubleValue()));
  return info.Env().Undefined();
}

static Napi::Value GetFps(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || !p_libvlc_media_player_get_fps) return Napi::Number::New(env, 0);
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::Number::New(env, p_libvlc_media_player_get_fps(s->mp));
}

static Napi::Value GetChapter(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || !p_libvlc_media_player_get_chapter) return Napi::Number::New(env, -1);
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::Number::New(env, p_libvlc_media_player_get_chapter(s->mp));
}

static Napi::Value SetChapter(const Napi::CallbackInfo &info) {
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || info.Length() < 2 || !p_libvlc_media_player_set_chapter) return info.Env().Undefined();
  std::lock_guard<std::mutex> lock(g_mutex);
  p_libvlc_media_player_set_chapter(s->mp, info[1].As<Napi::Number>().Int32Value());
  return info.Env().Undefined();
}

static Napi::Value GetChapterCount(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || !p_libvlc_media_player_get_chapter_count) return Napi::Number::New(env, -1);
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::Number::New(env, p_libvlc_media_player_get_chapter_count(s->mp));
}

static Napi::Value GetChapterDescriptions(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || !p_libvlc_media_player_get_chapter_description) return Napi::Array::New(env);
  const int title = info.Length() >= 2 ? info[1].As<Napi::Number>().Int32Value() : -1;
  std::lock_guard<std::mutex> lock(g_mutex);
  libvlc_track_description_t *tracks = p_libvlc_media_player_get_chapter_description(s->mp, title);
  Napi::Array arr = TracksToArray(env, tracks);
  if (tracks) p_libvlc_track_description_list_release(tracks);
  return arr;
}

static Napi::Value GetTitleIndex(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || !p_libvlc_media_player_get_title) return Napi::Number::New(env, -1);
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::Number::New(env, p_libvlc_media_player_get_title(s->mp));
}

static Napi::Value SetTitleIndex(const Napi::CallbackInfo &info) {
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || info.Length() < 2 || !p_libvlc_media_player_set_title) return info.Env().Undefined();
  std::lock_guard<std::mutex> lock(g_mutex);
  p_libvlc_media_player_set_title(s->mp, info[1].As<Napi::Number>().Int32Value());
  return info.Env().Undefined();
}

static Napi::Value GetTitleCount(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || !p_libvlc_media_player_get_title_count) return Napi::Number::New(env, -1);
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::Number::New(env, p_libvlc_media_player_get_title_count(s->mp));
}

static Napi::Value GetTitleDescriptions(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || !p_libvlc_media_player_get_title_description) return Napi::Array::New(env);
  const int title = info.Length() >= 2 ? info[1].As<Napi::Number>().Int32Value() : -1;
  std::lock_guard<std::mutex> lock(g_mutex);
  libvlc_track_description_t *tracks = p_libvlc_media_player_get_title_description(s->mp, title);
  Napi::Array arr = TracksToArray(env, tracks);
  if (tracks) p_libvlc_track_description_list_release(tracks);
  return arr;
}

static Napi::Value NextChapter(const Napi::CallbackInfo &info) {
  PlayerState *s = GetPlayerArg(info);
  if (s && s->mp && p_libvlc_media_player_next_chapter) {
    std::lock_guard<std::mutex> lock(g_mutex);
    p_libvlc_media_player_next_chapter(s->mp);
  }
  return info.Env().Undefined();
}

static Napi::Value PreviousChapter(const Napi::CallbackInfo &info) {
  PlayerState *s = GetPlayerArg(info);
  if (s && s->mp && p_libvlc_media_player_previous_chapter) {
    std::lock_guard<std::mutex> lock(g_mutex);
    p_libvlc_media_player_previous_chapter(s->mp);
  }
  return info.Env().Undefined();
}

static Napi::Value Navigate(const Napi::CallbackInfo &info) {
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || info.Length() < 2 || !p_libvlc_media_player_navigate) return info.Env().Undefined();
  std::lock_guard<std::mutex> lock(g_mutex);
  p_libvlc_media_player_navigate(s->mp, info[1].As<Napi::Number>().Uint32Value());
  return info.Env().Undefined();
}

static Napi::Value GetVlcFullscreen(const Napi::CallbackInfo &info) {
  return BoolPlayerApi(info, p_libvlc_media_player_get_fullscreen);
}

static Napi::Value SetVlcFullscreen(const Napi::CallbackInfo &info) {
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || info.Length() < 2 || !p_libvlc_media_player_set_fullscreen) return info.Env().Undefined();
  std::lock_guard<std::mutex> lock(g_mutex);
  p_libvlc_media_player_set_fullscreen(s->mp, info[1].As<Napi::Boolean>().Value() ? 1 : 0);
  return info.Env().Undefined();
}

static Napi::Value GetRole(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || !p_libvlc_media_player_get_role) return Napi::Number::New(env, 0);
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::Number::New(env, static_cast<int>(p_libvlc_media_player_get_role(s->mp)));
}

static Napi::Value SetRole(const Napi::CallbackInfo &info) {
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || info.Length() < 2 || !p_libvlc_media_player_set_role) return info.Env().Undefined();
  std::lock_guard<std::mutex> lock(g_mutex);
  p_libvlc_media_player_set_role(s->mp,
                                 static_cast<libvlc_media_player_role_t>(info[1].As<Napi::Number>().Int32Value()));
  return info.Env().Undefined();
}

static Napi::Value ToggleMute(const Napi::CallbackInfo &info) {
  PlayerState *s = GetPlayerArg(info);
  if (s && s->mp && p_libvlc_audio_toggle_mute) {
    std::lock_guard<std::mutex> lock(g_mutex);
    p_libvlc_audio_toggle_mute(s->mp);
  }
  return info.Env().Undefined();
}

static int ReadPlayerMuteRaw(libvlc_media_player_t *mp) {
  if (!mp || !p_libvlc_audio_get_mute) return -1;
  return p_libvlc_audio_get_mute(mp);
}

static Napi::Value GetMuteRaw(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp) return Napi::Number::New(env, -1);
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::Number::New(env, ReadPlayerMuteRaw(s->mp));
}

static Napi::Value GetMute(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp) return Napi::Boolean::New(env, false);
  std::lock_guard<std::mutex> lock(g_mutex);
  const int raw = ReadPlayerMuteRaw(s->mp);
  return Napi::Boolean::New(env, raw > 0);
}

static Napi::Value SetMute(const Napi::CallbackInfo &info) {
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || info.Length() < 2 || !p_libvlc_audio_set_mute) return info.Env().Undefined();
  std::lock_guard<std::mutex> lock(g_mutex);
  p_libvlc_audio_set_mute(s->mp, info[1].As<Napi::Boolean>().Value() ? 1 : 0);
  return info.Env().Undefined();
}

static Napi::Value GetAudioChannel(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || !p_libvlc_audio_get_channel) return Napi::Number::New(env, 0);
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::Number::New(env, p_libvlc_audio_get_channel(s->mp));
}

static Napi::Value SetAudioChannel(const Napi::CallbackInfo &info) {
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || info.Length() < 2 || !p_libvlc_audio_set_channel) return info.Env().Undefined();
  std::lock_guard<std::mutex> lock(g_mutex);
  p_libvlc_audio_set_channel(s->mp, info[1].As<Napi::Number>().Int32Value());
  return info.Env().Undefined();
}

static Napi::Value GetAudioDelay(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || !p_libvlc_audio_get_delay) return Napi::Number::New(env, 0);
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::Number::New(env, static_cast<double>(p_libvlc_audio_get_delay(s->mp)));
}

static Napi::Value SetAudioDelay(const Napi::CallbackInfo &info) {
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || info.Length() < 2 || !p_libvlc_audio_set_delay) return info.Env().Undefined();
  std::lock_guard<std::mutex> lock(g_mutex);
  p_libvlc_audio_set_delay(s->mp, static_cast<long long>(info[1].As<Napi::Number>().Int64Value()));
  return info.Env().Undefined();
}

static Napi::Value GetVideoTracks(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || !p_libvlc_video_get_track_description) return Napi::Array::New(env);
  std::lock_guard<std::mutex> lock(g_mutex);
  libvlc_track_description_t *tracks = p_libvlc_video_get_track_description(s->mp);
  Napi::Array arr = TracksToArray(env, tracks);
  if (tracks) p_libvlc_track_description_list_release(tracks);
  return arr;
}

static Napi::Value GetVideoTrack(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || !p_libvlc_video_get_track) return Napi::Number::New(env, -1);
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::Number::New(env, p_libvlc_video_get_track(s->mp));
}

static Napi::Value SetVideoTrack(const Napi::CallbackInfo &info) {
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || info.Length() < 2 || !p_libvlc_video_set_track) return info.Env().Undefined();
  std::lock_guard<std::mutex> lock(g_mutex);
  p_libvlc_video_set_track(s->mp, info[1].As<Napi::Number>().Int32Value());
  return info.Env().Undefined();
}

static Napi::Value GetScale(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || !p_libvlc_video_get_scale) return Napi::Number::New(env, 1);
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::Number::New(env, p_libvlc_video_get_scale(s->mp));
}

static Napi::Value SetScale(const Napi::CallbackInfo &info) {
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || info.Length() < 2 || !p_libvlc_video_set_scale) return info.Env().Undefined();
  std::lock_guard<std::mutex> lock(g_mutex);
  p_libvlc_video_set_scale(s->mp, static_cast<float>(info[1].As<Napi::Number>().DoubleValue()));
  return info.Env().Undefined();
}

static Napi::Value GetAspectRatio(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || !p_libvlc_video_get_aspect_ratio) return Napi::String::New(env, "");
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::String::New(env, TakeLibVlcString(p_libvlc_video_get_aspect_ratio(s->mp)));
}

static Napi::Value SetAspectRatio(const Napi::CallbackInfo &info) {
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || info.Length() < 2 || !p_libvlc_video_set_aspect_ratio) return info.Env().Undefined();
  std::lock_guard<std::mutex> lock(g_mutex);
  p_libvlc_video_set_aspect_ratio(s->mp, info[1].As<Napi::String>().Utf8Value().c_str());
  return info.Env().Undefined();
}

static Napi::Value SetCropGeometry(const Napi::CallbackInfo &info) {
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || info.Length() < 2 || !p_libvlc_video_set_crop_geometry) return info.Env().Undefined();
  std::lock_guard<std::mutex> lock(g_mutex);
  p_libvlc_video_set_crop_geometry(s->mp, info[1].As<Napi::String>().Utf8Value().c_str());
  return info.Env().Undefined();
}

static Napi::Value GetVideoSize(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  Napi::Object o = Napi::Object::New(env);
  o.Set("width", 0);
  o.Set("height", 0);
  if (!s || !s->mp || !p_libvlc_video_get_size) return o;
  libvlc_media_player_t *mp = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    mp = s->mp;
  }
  unsigned w = 0;
  unsigned h = 0;
  if (p_libvlc_video_get_size(mp, 0, &w, &h) != 0) {
    w = 0;
    h = 0;
  }
  o.Set("width", Napi::Number::New(env, w));
  o.Set("height", Napi::Number::New(env, h));
  return o;
}

static Napi::Value GetDeinterlace(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || !p_libvlc_video_get_deinterlace) return Napi::String::New(env, "");
  std::lock_guard<std::mutex> lock(g_mutex);
  return Napi::String::New(env, TakeLibVlcString(p_libvlc_video_get_deinterlace(s->mp)));
}

static Napi::Value SetDeinterlace(const Napi::CallbackInfo &info) {
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || info.Length() < 2 || !p_libvlc_video_set_deinterlace) return info.Env().Undefined();
  std::lock_guard<std::mutex> lock(g_mutex);
  p_libvlc_video_set_deinterlace(s->mp, info[1].As<Napi::String>().Utf8Value().c_str());
  return info.Env().Undefined();
}

static Napi::Value TakeSnapshot(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s || !s->mp || info.Length() < 2 || !p_libvlc_video_take_snapshot) {
    return Napi::Boolean::New(env, false);
  }
  const std::string path = info[1].As<Napi::String>().Utf8Value();
  const unsigned num = info.Length() >= 3 ? info[2].As<Napi::Number>().Uint32Value() : 0;
  const unsigned width = info.Length() >= 4 ? info[3].As<Napi::Number>().Uint32Value() : 0;
  const unsigned height = info.Length() >= 5 ? info[4].As<Napi::Number>().Uint32Value() : 0;
  libvlc_media_player_t *mp = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    mp = s->mp;
  }
  // 与 set_time/play 相同：libvlc 可能同步触发事件回调，持锁会死锁
  const int ok = p_libvlc_video_take_snapshot(mp, num, path.c_str(), width, height);
  return Napi::Boolean::New(env, ok == 0);
}

static Napi::Value GetMediaInfo(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  Napi::Object o = Napi::Object::New(env);
  o.Set("duration", -1);
  o.Set("state", 0);
  o.Set("parsed", false);
  if (!s || !s->mp) return o;
  std::lock_guard<std::mutex> lock(g_mutex);
  libvlc_media_t *media = s->media;
  if (!media && p_libvlc_media_player_get_media) {
    media = p_libvlc_media_player_get_media(s->mp);
  }
  if (!media) return o;
  if (p_libvlc_media_get_duration) {
    o.Set("duration", Napi::Number::New(env, static_cast<double>(p_libvlc_media_get_duration(media))));
  }
  if (p_libvlc_media_get_state) {
    o.Set("state", Napi::Number::New(env, static_cast<int>(p_libvlc_media_get_state(media))));
  }
  if (p_libvlc_media_is_parsed) {
    o.Set("parsed", Napi::Boolean::New(env, p_libvlc_media_is_parsed(media) != 0));
  }
  return o;
}

static Napi::Value SetMediaEx(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *state = GetPlayerArg(info);
  if (!state) {
    Napi::Error::New(env, "Invalid player id").ThrowAsJavaScriptException();
    return env.Null();
  }
  if (info.Length() < 2 || !info[1].IsString()) {
    Napi::TypeError::New(env, "setMediaEx(id, src, autoplay?, options?)").ThrowAsJavaScriptException();
    return env.Null();
  }
  const std::string src = info[1].As<Napi::String>().Utf8Value();
  const bool autoplay = info.Length() < 3 || !info[2].IsBoolean() ? true : info[2].As<Napi::Boolean>().Value();
  const std::vector<std::string> options =
      info.Length() >= 4 ? ParseStringArray(env, info[3]) : std::vector<std::string>();

  std::string error;
  if (!VlcEnsureMediaPlayer(state, &error)) {
    Napi::Error::New(env, error).ThrowAsJavaScriptException();
    return env.Null();
  }
  if (!VlcLoadMediaIntoPlayer(state, src, options, &error)) {
    Napi::Error::New(env, error).ThrowAsJavaScriptException();
    return env.Null();
  }
  if (autoplay && state->mp) {
    VlcAttachPlayerDrawable(state);
    p_libvlc_media_player_play(state->mp);
  }
  return Napi::Boolean::New(env, true);
}

void RegisterVlcPlayerApiExports(Napi::Env env, Napi::Object exports) {
  exports.Set("getLibVlcVersion", Napi::Function::New(env, GetLibVlcVersion));
  exports.Set("setMediaEx", Napi::Function::New(env, SetMediaEx));
  exports.Set("getState", Napi::Function::New(env, GetState));
  exports.Set("willPlay", Napi::Function::New(env, WillPlay));
  exports.Set("canPause", Napi::Function::New(env, CanPause));
  exports.Set("isPaused", Napi::Function::New(env, IsPaused));
  exports.Set("setPause", Napi::Function::New(env, SetPause));
  exports.Set("isSeekable", Napi::Function::New(env, IsSeekable));
  exports.Set("hasVout", Napi::Function::New(env, HasVout));
  exports.Set("getPosition", Napi::Function::New(env, GetPosition));
  exports.Set("setPosition", Napi::Function::New(env, SetPosition));
  exports.Set("getRate", Napi::Function::New(env, GetRate));
  exports.Set("setRate", Napi::Function::New(env, SetRate));
  exports.Set("getFps", Napi::Function::New(env, GetFps));
  exports.Set("getChapter", Napi::Function::New(env, GetChapter));
  exports.Set("setChapter", Napi::Function::New(env, SetChapter));
  exports.Set("getChapterCount", Napi::Function::New(env, GetChapterCount));
  exports.Set("getChapterDescriptions", Napi::Function::New(env, GetChapterDescriptions));
  exports.Set("getTitleIndex", Napi::Function::New(env, GetTitleIndex));
  exports.Set("setTitleIndex", Napi::Function::New(env, SetTitleIndex));
  exports.Set("getTitleCount", Napi::Function::New(env, GetTitleCount));
  exports.Set("getTitleDescriptions", Napi::Function::New(env, GetTitleDescriptions));
  exports.Set("nextChapter", Napi::Function::New(env, NextChapter));
  exports.Set("previousChapter", Napi::Function::New(env, PreviousChapter));
  exports.Set("navigate", Napi::Function::New(env, Navigate));
  exports.Set("getVlcFullscreen", Napi::Function::New(env, GetVlcFullscreen));
  exports.Set("setVlcFullscreen", Napi::Function::New(env, SetVlcFullscreen));
  exports.Set("getRole", Napi::Function::New(env, GetRole));
  exports.Set("setRole", Napi::Function::New(env, SetRole));
  exports.Set("toggleMute", Napi::Function::New(env, ToggleMute));
  exports.Set("getMuteRaw", Napi::Function::New(env, GetMuteRaw));
  exports.Set("getMute", Napi::Function::New(env, GetMute));
  exports.Set("setMute", Napi::Function::New(env, SetMute));
  exports.Set("getAudioChannel", Napi::Function::New(env, GetAudioChannel));
  exports.Set("setAudioChannel", Napi::Function::New(env, SetAudioChannel));
  exports.Set("getAudioDelay", Napi::Function::New(env, GetAudioDelay));
  exports.Set("setAudioDelay", Napi::Function::New(env, SetAudioDelay));
  exports.Set("getVideoTracks", Napi::Function::New(env, GetVideoTracks));
  exports.Set("getVideoTrack", Napi::Function::New(env, GetVideoTrack));
  exports.Set("setVideoTrack", Napi::Function::New(env, SetVideoTrack));
  exports.Set("getScale", Napi::Function::New(env, GetScale));
  exports.Set("setScale", Napi::Function::New(env, SetScale));
  exports.Set("getAspectRatio", Napi::Function::New(env, GetAspectRatio));
  exports.Set("setAspectRatio", Napi::Function::New(env, SetAspectRatio));
  exports.Set("setCropGeometry", Napi::Function::New(env, SetCropGeometry));
  exports.Set("getVideoSize", Napi::Function::New(env, GetVideoSize));
  exports.Set("getDeinterlace", Napi::Function::New(env, GetDeinterlace));
  exports.Set("setDeinterlace", Napi::Function::New(env, SetDeinterlace));
  exports.Set("takeSnapshot", Napi::Function::New(env, TakeSnapshot));
  exports.Set("getMediaInfo", Napi::Function::New(env, GetMediaInfo));
  RegisterVlcMediaInfoExports(env, exports);
}
