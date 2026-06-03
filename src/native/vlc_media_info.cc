#include "vlc_media_info.h"

#include <chrono>
#include <thread>

#include "libvlc_dynload.h"
#include "vlc_media_events.h"
#include "vlc_media_util.h"
#include "vlc_state.h"

static PlayerState *GetPlayerArg(const Napi::CallbackInfo &info, int index = 0) {
  if (info.Length() <= static_cast<size_t>(index) || !info[index].IsNumber()) return nullptr;
  return VlcFindPlayer(info[index].As<Napi::Number>().Int32Value());
}

static std::string TakeLibVlcString(char *s) {
  if (!s) return "";
  std::string out(s);
  if (p_libvlc_free) p_libvlc_free(s);
  return out;
}

/** 调用方已持有 g_mutex；仅取指针，勿在持锁时调用 libVLC parse/meta。 */
static libvlc_media_t *GetPlayerMediaLocked(PlayerState *state) {
  if (!state || !state->mp) return nullptr;
  libvlc_media_t *media = state->media;
  if (!media && p_libvlc_media_player_get_media) {
    media = p_libvlc_media_player_get_media(state->mp);
  }
  return media;
}

/** libvlc_media_do_parse */
static const int kMediaParseDoParse = 0x40;

static bool IsMediaParsed(libvlc_media_t *media) {
  return media && p_libvlc_media_is_parsed && p_libvlc_media_is_parsed(media) != 0;
}

static bool EnsureMediaParsed(libvlc_media_t *media, PlayerState *state, int timeoutMs) {
  if (!media) return false;
  if (IsMediaParsed(media)) {
    if (state) state->media_parse_started = false;
    return true;
  }
  if (state && timeoutMs == 0 && state->media_parse_started) {
    return IsMediaParsed(media);
  }
  bool ok = false;
  if (p_libvlc_media_parse_with_options) {
    ok = p_libvlc_media_parse_with_options(media, timeoutMs, kMediaParseDoParse) == 0;
  } else if (p_libvlc_media_parse) {
    ok = p_libvlc_media_parse(media) == 0;
  }
  if (state && timeoutMs == 0) {
    state->media_parse_started = true;
  }
  if (IsMediaParsed(media) && state) {
    state->media_parse_started = false;
  }
  return ok || IsMediaParsed(media);
}

/** 独立 media（probeMedia）：sync parse 未完成时再 async + 轮询 is_parsed */
static bool WaitMediaParsedStandalone(libvlc_media_t *media, int timeoutMs) {
  if (!media) return false;
  if (IsMediaParsed(media)) return true;

  const int waitMs = timeoutMs > 0 ? timeoutMs : 5000;
  EnsureMediaParsed(media, nullptr, waitMs);
  if (IsMediaParsed(media)) return true;

  if (p_libvlc_media_parse_with_options) {
    p_libvlc_media_parse_with_options(media, 0, kMediaParseDoParse);
  } else if (p_libvlc_media_parse) {
    p_libvlc_media_parse(media);
  }

  const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(waitMs);
  while (!IsMediaParsed(media)) {
    if (std::chrono::steady_clock::now() >= deadline) break;
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
  }
  return IsMediaParsed(media);
}

static void SetMetaField(Napi::Object &obj, Napi::Env env, const char *key, libvlc_media_t *media,
                         libvlc_meta_t meta) {
  if (!p_libvlc_media_get_meta) return;
  const std::string value = TakeLibVlcString(p_libvlc_media_get_meta(media, meta));
  if (!value.empty()) {
    obj.Set(key, Napi::String::New(env, value));
  }
}

static const char *TrackTypeName(int type) {
  switch (type) {
    case libvlc_track_video:
      return "video";
    case libvlc_track_audio:
      return "audio";
    case libvlc_track_text:
      return "subtitle";
    default:
      return "unknown";
  }
}

static void SetTrackObjectCommon(Napi::Object &item, Napi::Env env, int id, int type,
                                 const char *codec, const char *language, const char *description,
                                 unsigned bitrate) {
  item.Set("id", Napi::Number::New(env, id));
  item.Set("type", Napi::String::New(env, TrackTypeName(type)));
  if (codec && codec[0]) item.Set("codec", Napi::String::New(env, codec));
  if (language && language[0]) item.Set("language", Napi::String::New(env, language));
  if (description && description[0]) item.Set("description", Napi::String::New(env, description));
  if (bitrate > 0) item.Set("bitrate", Napi::Number::New(env, bitrate));
}

static Napi::Array BuildTracksV4(Napi::Env env, libvlc_media_t *media) {
  Napi::Array arr = Napi::Array::New(env);
  if (!media || !p_libvlc_media_tracks_get || !p_libvlc_media_tracks_release_v4) {
    return arr;
  }
  libvlc_media_track_t **tracks = nullptr;
  const size_t count = p_libvlc_media_tracks_get(media, &tracks);
  if (count > 64) {
    if (tracks) p_libvlc_media_tracks_release_v4(tracks, count);
    return arr;
  }
  uint32_t outIndex = 0;
  for (size_t i = 0; i < count && tracks; i++) {
    const libvlc_media_track_t *t = tracks[i];
    if (!t) continue;
    Napi::Object item = Napi::Object::New(env);
    const char *codec = t->psz_codec_description && t->psz_codec_description[0]
                            ? t->psz_codec_description
                            : nullptr;
    SetTrackObjectCommon(item, env, t->i_id, t->i_type, codec, t->psz_language, t->psz_description,
                         t->i_bitrate);
    if (t->i_type == libvlc_track_video) {
      if (t->u.video.i_width > 0 && t->u.video.i_height > 0) {
        item.Set("width", Napi::Number::New(env, t->u.video.i_width));
        item.Set("height", Napi::Number::New(env, t->u.video.i_height));
      }
      if (t->u.video.i_frame_rate_den > 0) {
        const double fps =
            static_cast<double>(t->u.video.i_frame_rate_num) / t->u.video.i_frame_rate_den;
        if (fps > 0) {
          item.Set("frameRate", Napi::Number::New(env, fps));
        }
      }
    } else if (t->i_type == libvlc_track_audio) {
      if (t->u.audio.i_channels > 0) {
        item.Set("channels", Napi::Number::New(env, t->u.audio.i_channels));
      }
      if (t->u.audio.i_rate > 0) {
        item.Set("sampleRate", Napi::Number::New(env, t->u.audio.i_rate));
      }
    }
    arr.Set(outIndex++, item);
  }
  if (tracks) {
    p_libvlc_media_tracks_release_v4(tracks, count);
  }
  return arr;
}

static Napi::Array BuildTracksV3(Napi::Env env, libvlc_media_t *media) {
  Napi::Array arr = Napi::Array::New(env);
  if (!media || !p_libvlc_media_get_tracks_info || !p_libvlc_media_tracks_release_v3) {
    return arr;
  }
  libvlc_media_track_info_t *tracks = nullptr;
  const unsigned count = p_libvlc_media_get_tracks_info(media, &tracks);
  if (count > 64) {
    if (tracks) p_libvlc_media_tracks_release_v3(&tracks);
    return arr;
  }
  uint32_t outIndex = 0;
  for (unsigned i = 0; i < count && tracks; i++) {
    const libvlc_media_track_info_t &t = tracks[i];
    Napi::Object item = Napi::Object::New(env);
    SetTrackObjectCommon(item, env, t.i_id, t.i_type, t.psz_codec, t.psz_language,
                         t.psz_description, static_cast<unsigned>(t.i_bitrate));
    if (t.i_type == libvlc_track_video) {
      if (t.u.video.i_width > 0 && t.u.video.i_height > 0) {
        item.Set("width", Napi::Number::New(env, t.u.video.i_width));
        item.Set("height", Napi::Number::New(env, t.u.video.i_height));
      }
    } else if (t.i_type == libvlc_track_audio) {
      if (t.u.audio.i_channels > 0) {
        item.Set("channels", Napi::Number::New(env, t.u.audio.i_channels));
      }
      if (t.u.audio.i_rate > 0) {
        item.Set("sampleRate", Napi::Number::New(env, t.u.audio.i_rate));
      }
    }
    arr.Set(outIndex++, item);
  }
  if (tracks) {
    p_libvlc_media_tracks_release_v3(&tracks);
  }
  return arr;
}

/** 已解析的 media 轨列表；勿在持有 g_mutex 时调用 libVLC（播放中亦然）。 */
static Napi::Array BuildMediaTracksForMedia(Napi::Env env, PlayerState *state,
                                            libvlc_media_t *media) {
  if (!media || !state || !IsMediaParsed(media)) return Napi::Array::New(env);
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (GetPlayerMediaLocked(state) != media) return Napi::Array::New(env);
  }
  if (p_libvlc_media_tracks_get) {
    return BuildTracksV4(env, media);
  }
  return BuildTracksV3(env, media);
}

static Napi::Value ParseMedia(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s) return Napi::Boolean::New(env, false);
  int timeoutMs = 5000;
  if (info.Length() >= 2 && info[1].IsNumber()) {
    timeoutMs = info[1].As<Napi::Number>().Int32Value();
  }
  libvlc_media_t *media = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    media = GetPlayerMediaLocked(s);
  }
  if (!media) return Napi::Boolean::New(env, false);
  if (s) s->media_ready_signaled = false;
  const bool ok = EnsureMediaParsed(media, s, timeoutMs);
  if (IsMediaParsed(media) && s) {
    VlcEmitMediaReady(s);
  }
  return Napi::Boolean::New(env, ok);
}

static Napi::Value GetMediaMetadata(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  Napi::Object o = Napi::Object::New(env);
  if (!s) return o;

  const bool shouldParse = info.Length() < 2 || !info[1].IsBoolean() || info[1].As<Napi::Boolean>().Value();
  int timeoutMs = 5000;
  if (info.Length() >= 3 && info[2].IsNumber()) {
    timeoutMs = info[2].As<Napi::Number>().Int32Value();
  }

  libvlc_media_t *media = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    media = GetPlayerMediaLocked(s);
  }
  if (!media || !p_libvlc_media_get_meta) return o;

  if (shouldParse) {
    EnsureMediaParsed(media, s, timeoutMs);
  }
  if (!IsMediaParsed(media)) return o;

  {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (GetPlayerMediaLocked(s) != media) return o;
  }
  SetMetaField(o, env, "title", media, libvlc_meta_Title);
  SetMetaField(o, env, "artist", media, libvlc_meta_Artist);
  SetMetaField(o, env, "album", media, libvlc_meta_Album);
  SetMetaField(o, env, "genre", media, libvlc_meta_Genre);
  SetMetaField(o, env, "date", media, libvlc_meta_Date);
  SetMetaField(o, env, "description", media, libvlc_meta_Description);
  SetMetaField(o, env, "copyright", media, libvlc_meta_Copyright);
  SetMetaField(o, env, "language", media, libvlc_meta_Language);
  SetMetaField(o, env, "publisher", media, libvlc_meta_Publisher);
  SetMetaField(o, env, "encodedBy", media, libvlc_meta_EncodedBy);
  SetMetaField(o, env, "trackNumber", media, libvlc_meta_TrackNumber);
  SetMetaField(o, env, "url", media, libvlc_meta_URL);
  SetMetaField(o, env, "nowPlaying", media, libvlc_meta_NowPlaying);
  SetMetaField(o, env, "artworkUrl", media, libvlc_meta_ArtworkURL);
  SetMetaField(o, env, "rating", media, libvlc_meta_Rating);
  SetMetaField(o, env, "showName", media, libvlc_meta_ShowName);
  SetMetaField(o, env, "actors", media, libvlc_meta_Actors);
  SetMetaField(o, env, "director", media, libvlc_meta_Director);
  SetMetaField(o, env, "albumArtist", media, libvlc_meta_AlbumArtist);
  return o;
}

static Napi::Value GetMediaTracks(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  PlayerState *s = GetPlayerArg(info);
  if (!s) return Napi::Array::New(env);

  const bool shouldParse = info.Length() < 2 || !info[1].IsBoolean() || info[1].As<Napi::Boolean>().Value();
  int timeoutMs = 5000;
  if (info.Length() >= 3 && info[2].IsNumber()) {
    timeoutMs = info[2].As<Napi::Number>().Int32Value();
  }

  libvlc_media_t *media = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    media = GetPlayerMediaLocked(s);
  }
  if (!media) return Napi::Array::New(env);

  if (shouldParse) {
    EnsureMediaParsed(media, s, timeoutMs);
  }
  return BuildMediaTracksForMedia(env, s, media);
}

/** 不绑定播放器：new_path → parse → duration/metadata → release（供播放列表预读时长） */
static Napi::Value ProbeMedia(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!g_vlc) {
    Napi::Error::New(env, "libvlc not initialized").ThrowAsJavaScriptException();
    return env.Null();
  }
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "probeMedia(src, timeoutMs?)").ThrowAsJavaScriptException();
    return env.Null();
  }
  const std::string src = info[0].As<Napi::String>().Utf8Value();
  int timeoutMs = 5000;
  if (info.Length() >= 2 && info[1].IsNumber()) {
    timeoutMs = info[1].As<Napi::Number>().Int32Value();
  }

  libvlc_media_t *media = VlcCreateMediaFromSrc(src);
  if (!media) {
    Napi::Error::New(env, "Failed to open media: " + src).ThrowAsJavaScriptException();
    return env.Null();
  }

  EnsureMediaParsed(media, nullptr, timeoutMs);
  const bool parsed = WaitMediaParsedStandalone(media, timeoutMs);

  Napi::Object result = Napi::Object::New(env);
  result.Set("parsed", Napi::Boolean::New(env, parsed));

  double length = 0;
  if (p_libvlc_media_get_duration) {
    length = static_cast<double>(p_libvlc_media_get_duration(media));
    if (length < 0) length = 0;
  }
  result.Set("length", Napi::Number::New(env, length));

  Napi::Object meta = Napi::Object::New(env);
  if (parsed && p_libvlc_media_get_meta) {
    SetMetaField(meta, env, "title", media, libvlc_meta_Title);
    SetMetaField(meta, env, "artist", media, libvlc_meta_Artist);
    SetMetaField(meta, env, "album", media, libvlc_meta_Album);
    SetMetaField(meta, env, "genre", media, libvlc_meta_Genre);
  }
  result.Set("metadata", meta);

  if (p_libvlc_media_release) {
    p_libvlc_media_release(media);
  }
  return result;
}

void RegisterVlcMediaInfoExports(Napi::Env env, Napi::Object exports) {
  exports.Set("parseMedia", Napi::Function::New(env, ParseMedia));
  exports.Set("probeMedia", Napi::Function::New(env, ProbeMedia));
  exports.Set("getMediaMetadata", Napi::Function::New(env, GetMediaMetadata));
  exports.Set("getMediaTracks", Napi::Function::New(env, GetMediaTracks));
}
