#include "vlc_media_util.h"

#include <cctype>
#include <cstdio>

#include "libvlc_dynload.h"
#include "vlc_media_events.h"
#include "vlc_state.h"

#ifdef _WIN32
static std::string UriEncodeUtf8(const std::string &utf8) {
  std::string out;
  out.reserve(utf8.size() * 3);
  for (unsigned char c : utf8) {
    if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
      out += static_cast<char>(c);
    } else {
      char hex[4];
      snprintf(hex, sizeof(hex), "%%%02X", c);
      out += hex;
    }
  }
  return out;
}

static std::string WindowsLocalPathToFileUri(const std::string &path) {
  if (path.empty()) return "";
  std::string norm = path;
  for (char &c : norm) {
    if (c == '\\') c = '/';
  }
  std::string uri = "file:///";
  if (norm.size() >= 2 && norm[1] == ':') {
    uri += static_cast<char>(std::toupper(static_cast<unsigned char>(norm[0])));
    uri += ':';
    std::string rest = norm.substr(2);
    while (!rest.empty() && rest[0] == '/') {
      rest.erase(0, 1);
    }
    uri += '/';
    uri += UriEncodeUtf8(rest);
    return uri;
  }
  uri += UriEncodeUtf8(norm);
  return uri;
}
#endif

libvlc_media_t *VlcCreateMediaFromSrc(const std::string &src) {
  if (!g_vlc || src.empty()) return nullptr;
  const bool isUrl = src.rfind("http://", 0) == 0 || src.rfind("https://", 0) == 0 ||
                     src.rfind("file://", 0) == 0;
  if (isUrl) {
    return p_libvlc_media_new_location(g_vlc, src.c_str());
  }
#ifdef _WIN32
  const bool looksLocal =
      (src.size() >= 2 && src[1] == ':') || src[0] == '/' || src[0] == '\\';
  if (looksLocal) {
    const std::wstring wpath = Utf8ToWide(src);
    if (p_libvlc_media_new_path) {
      libvlc_media_t *media = p_libvlc_media_new_path(g_vlc, WideToUtf8(wpath).c_str());
      if (media) return media;
      media = p_libvlc_media_new_path(g_vlc, src.c_str());
      if (media) return media;
    }
    const std::string uri = WindowsLocalPathToFileUri(src);
    if (p_libvlc_media_new_location) {
      return p_libvlc_media_new_location(g_vlc, uri.c_str());
    }
    return nullptr;
  }
  const std::wstring wpath = Utf8ToWide(src);
  libvlc_media_t *media = p_libvlc_media_new_path(g_vlc, WideToUtf8(wpath).c_str());
  if (!media) {
    media = p_libvlc_media_new_path(g_vlc, src.c_str());
  }
  return media;
#else
  return p_libvlc_media_new_path(g_vlc, src.c_str());
#endif
}

void VlcApplyMediaOptions(libvlc_media_t *media, const std::vector<std::string> &options) {
  if (!media || !p_libvlc_media_add_option) return;
  for (const std::string &opt : options) {
    if (!opt.empty()) {
      p_libvlc_media_add_option(media, opt.c_str());
    }
  }
}

/**
 * 换源前正确 teardown 当前媒体（勿在持 g_mutex 时调用 libVLC）：
 * pause → stop（已暂停/停止时）→ set_media(NULL) → media_release。
 * 播放中仅 pause + 断开，避免 4K 嵌入式 stop 卡 UI。
 */
static void VlcDisconnectAndReleaseMedia(PlayerState *state, libvlc_media_t *old_media) {
  if (!state || !state->mp || !old_media) return;

  const bool was_playing =
      p_libvlc_media_player_is_playing && p_libvlc_media_player_is_playing(state->mp) != 0;

  if (p_libvlc_media_player_set_pause) {
    p_libvlc_media_player_set_pause(state->mp, 1);
  }
  if (!was_playing && p_libvlc_media_player_stop) {
    p_libvlc_media_player_stop(state->mp);
  }
  if (p_libvlc_media_player_set_media) {
    p_libvlc_media_player_set_media(state->mp, nullptr);
  }
  if (p_libvlc_media_release) {
    p_libvlc_media_release(old_media);
  }
  state->time_ms = 0;
  state->length_ms = 0;
}

bool VlcLoadMediaIntoPlayer(PlayerState *state, const std::string &src,
                            const std::vector<std::string> &options, std::string *error) {
  if (!state) {
    if (error) *error = "Invalid player";
    return false;
  }
  if (!VlcEnsureMediaPlayer(state, error)) {
    return false;
  }

  libvlc_media_t *old_media = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    VlcDetachMediaEvents(state);
    old_media = state->media;
    state->media = nullptr;
    state->media_parse_started = false;
    state->media_ready_signaled = false;
  }

  if (old_media) {
    VlcDisconnectAndReleaseMedia(state, old_media);
  }

  libvlc_media_t *media = VlcCreateMediaFromSrc(src);
  if (!media) {
    if (error) *error = "Failed to open media: " + src;
    return false;
  }
  VlcApplyMediaOptions(media, options);

  {
    std::lock_guard<std::mutex> lock(g_mutex);
    state->media = media;
  }

  p_libvlc_media_player_set_media(state->mp, media);
  VlcAttachMediaEvents(state);

  return true;
}
