#include "libvlc_dynload.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <dlfcn.h>
#include <unistd.h>
#endif

libvlc_instance_t *g_vlc = nullptr;
void *g_libvlc_module = nullptr;
std::string g_vlc_dir;
std::string g_vlc_avcodec_hw;
static std::vector<std::string> g_vlc_argv_storage;
static std::vector<const char *> g_vlc_argv_ptrs;
/** Windows _putenv 不复制字符串，须保持存活 */
static std::string g_vlc_plugin_path_env_storage;

static void SetVlcPluginPathEnv(const std::string &pluginPath) {
#ifdef _WIN32
  g_vlc_plugin_path_env_storage = "VLC_PLUGIN_PATH=" + pluginPath;
  _putenv(g_vlc_plugin_path_env_storage.c_str());
#else
  setenv("VLC_PLUGIN_PATH", pluginPath.c_str(), 1);
#endif
}

static void ClearVlcPluginPathEnv() {
#ifdef _WIN32
  g_vlc_plugin_path_env_storage = "VLC_PLUGIN_PATH=";
  _putenv(g_vlc_plugin_path_env_storage.c_str());
#else
  unsetenv("VLC_PLUGIN_PATH");
#endif
}

libvlc_new_t p_libvlc_new = nullptr;
libvlc_release_t p_libvlc_release = nullptr;
libvlc_get_version_t p_libvlc_get_version = nullptr;
libvlc_get_compiler_t p_libvlc_get_compiler = nullptr;
libvlc_get_changeset_t p_libvlc_get_changeset = nullptr;
libvlc_free_t p_libvlc_free = nullptr;
libvlc_media_new_path_t p_libvlc_media_new_path = nullptr;
libvlc_media_add_option_t p_libvlc_media_add_option = nullptr;
libvlc_media_get_duration_t p_libvlc_media_get_duration = nullptr;
libvlc_media_get_state_t p_libvlc_media_get_state = nullptr;
libvlc_media_is_parsed_t p_libvlc_media_is_parsed = nullptr;
libvlc_media_get_meta_t p_libvlc_media_get_meta = nullptr;
libvlc_media_parse_t p_libvlc_media_parse = nullptr;
libvlc_media_parse_with_options_t p_libvlc_media_parse_with_options = nullptr;
libvlc_media_get_tracks_info_t p_libvlc_media_get_tracks_info = nullptr;
libvlc_media_tracks_get_t p_libvlc_media_tracks_get = nullptr;
libvlc_media_tracks_release_v3_t p_libvlc_media_tracks_release_v3 = nullptr;
libvlc_media_tracks_release_v4_t p_libvlc_media_tracks_release_v4 = nullptr;
/** VLC 4+ set_time/set_position 带 b_fast 参数 */
static bool g_libvlc_seek_has_fast_param = false;
libvlc_media_new_location_t p_libvlc_media_new_location = nullptr;
libvlc_media_release_t p_libvlc_media_release = nullptr;
libvlc_media_player_new_t p_libvlc_media_player_new = nullptr;
libvlc_media_player_new_from_media_t p_libvlc_media_player_new_from_media = nullptr;
libvlc_media_player_set_media_t p_libvlc_media_player_set_media = nullptr;
libvlc_media_player_release_t p_libvlc_media_player_release = nullptr;
libvlc_media_player_play_t p_libvlc_media_player_play = nullptr;
libvlc_media_player_pause_t p_libvlc_media_player_pause = nullptr;
libvlc_media_player_stop_t p_libvlc_media_player_stop = nullptr;
libvlc_media_player_get_state_t p_libvlc_media_player_get_state = nullptr;
libvlc_media_player_will_play_t p_libvlc_media_player_will_play = nullptr;
libvlc_media_player_can_pause_t p_libvlc_media_player_can_pause = nullptr;
libvlc_media_player_set_pause_t p_libvlc_media_player_set_pause = nullptr;
libvlc_media_player_is_paused_t p_libvlc_media_player_is_paused = nullptr;
libvlc_media_player_is_playing_t p_libvlc_media_player_is_playing = nullptr;
libvlc_media_player_is_seekable_t p_libvlc_media_player_is_seekable = nullptr;
libvlc_media_player_has_vout_t p_libvlc_media_player_has_vout = nullptr;
libvlc_media_player_get_position_t p_libvlc_media_player_get_position = nullptr;
libvlc_media_player_set_position_t p_libvlc_media_player_set_position = nullptr;
libvlc_media_player_get_rate_t p_libvlc_media_player_get_rate = nullptr;
libvlc_media_player_set_rate_t p_libvlc_media_player_set_rate = nullptr;
libvlc_media_player_get_fps_t p_libvlc_media_player_get_fps = nullptr;
libvlc_media_player_get_chapter_t p_libvlc_media_player_get_chapter = nullptr;
libvlc_media_player_set_chapter_t p_libvlc_media_player_set_chapter = nullptr;
libvlc_media_player_get_chapter_count_t p_libvlc_media_player_get_chapter_count = nullptr;
libvlc_media_player_get_chapter_description_t p_libvlc_media_player_get_chapter_description = nullptr;
libvlc_media_player_get_title_t p_libvlc_media_player_get_title = nullptr;
libvlc_media_player_set_title_t p_libvlc_media_player_set_title = nullptr;
libvlc_media_player_get_title_count_t p_libvlc_media_player_get_title_count = nullptr;
libvlc_media_player_get_title_description_t p_libvlc_media_player_get_title_description = nullptr;
libvlc_media_player_next_chapter_t p_libvlc_media_player_next_chapter = nullptr;
libvlc_media_player_previous_chapter_t p_libvlc_media_player_previous_chapter = nullptr;
libvlc_media_player_navigate_t p_libvlc_media_player_navigate = nullptr;
libvlc_media_player_set_fullscreen_t p_libvlc_media_player_set_fullscreen = nullptr;
libvlc_media_player_get_fullscreen_t p_libvlc_media_player_get_fullscreen = nullptr;
libvlc_media_player_get_role_t p_libvlc_media_player_get_role = nullptr;
libvlc_media_player_set_role_t p_libvlc_media_player_set_role = nullptr;
libvlc_media_player_get_media_t p_libvlc_media_player_get_media = nullptr;
libvlc_media_player_get_time_t p_libvlc_media_player_get_time = nullptr;
libvlc_media_player_set_time_t p_libvlc_media_player_set_time = nullptr;
libvlc_media_player_get_length_t p_libvlc_media_player_get_length = nullptr;
libvlc_audio_set_volume_t p_libvlc_audio_set_volume = nullptr;
libvlc_audio_get_volume_t p_libvlc_audio_get_volume = nullptr;
libvlc_audio_toggle_mute_t p_libvlc_audio_toggle_mute = nullptr;
libvlc_audio_get_mute_t p_libvlc_audio_get_mute = nullptr;
libvlc_audio_set_mute_t p_libvlc_audio_set_mute = nullptr;
libvlc_audio_get_channel_t p_libvlc_audio_get_channel = nullptr;
libvlc_audio_set_channel_t p_libvlc_audio_set_channel = nullptr;
libvlc_audio_get_delay_t p_libvlc_audio_get_delay = nullptr;
libvlc_audio_set_delay_t p_libvlc_audio_set_delay = nullptr;
libvlc_audio_get_track_description_t p_libvlc_audio_get_track_description = nullptr;
libvlc_video_get_track_t p_libvlc_video_get_track = nullptr;
libvlc_video_set_track_t p_libvlc_video_set_track = nullptr;
libvlc_video_get_track_description_t p_libvlc_video_get_track_description = nullptr;
libvlc_video_get_scale_t p_libvlc_video_get_scale = nullptr;
libvlc_video_set_scale_t p_libvlc_video_set_scale = nullptr;
libvlc_video_get_aspect_ratio_t p_libvlc_video_get_aspect_ratio = nullptr;
libvlc_video_set_aspect_ratio_t p_libvlc_video_set_aspect_ratio = nullptr;
libvlc_video_set_crop_geometry_t p_libvlc_video_set_crop_geometry = nullptr;
libvlc_video_get_size_t p_libvlc_video_get_size = nullptr;
libvlc_video_get_deinterlace_t p_libvlc_video_get_deinterlace = nullptr;
libvlc_video_set_deinterlace_t p_libvlc_video_set_deinterlace = nullptr;
libvlc_video_take_snapshot_t p_libvlc_video_take_snapshot = nullptr;
libvlc_audio_get_track_t p_libvlc_audio_get_track = nullptr;
libvlc_audio_set_track_t p_libvlc_audio_set_track = nullptr;
libvlc_track_description_list_release_t p_libvlc_track_description_list_release = nullptr;
libvlc_video_get_spu_description_t p_libvlc_video_get_spu_description = nullptr;
libvlc_video_get_spu_t p_libvlc_video_get_spu = nullptr;
libvlc_video_set_spu_t p_libvlc_video_set_spu = nullptr;
libvlc_media_player_add_slave_t p_libvlc_media_player_add_slave = nullptr;
libvlc_media_event_manager_t p_libvlc_media_event_manager = nullptr;
libvlc_media_player_event_manager_t p_libvlc_media_player_event_manager = nullptr;
libvlc_event_attach_t p_libvlc_event_attach = nullptr;
libvlc_event_detach_t p_libvlc_event_detach = nullptr;
libvlc_media_player_set_hwnd_t p_libvlc_media_player_set_hwnd = nullptr;
libvlc_media_player_set_nsobject_t p_libvlc_media_player_set_nsobject = nullptr;
libvlc_media_player_set_xwindow_t p_libvlc_media_player_set_xwindow = nullptr;

static void *LoadSym(const char *name) {
  if (!g_libvlc_module) return nullptr;
#ifdef _WIN32
  return reinterpret_cast<void *>(GetProcAddress(static_cast<HMODULE>(g_libvlc_module), name));
#else
  return dlsym(g_libvlc_module, name);
#endif
}

static bool ResolveExports(std::string *error) {
  p_libvlc_new = (libvlc_new_t)LoadSym("libvlc_new");
  p_libvlc_release = (libvlc_release_t)LoadSym("libvlc_release");
  p_libvlc_media_new_path = (libvlc_media_new_path_t)LoadSym("libvlc_media_new_path");
  p_libvlc_media_new_location = (libvlc_media_new_location_t)LoadSym("libvlc_media_new_location");
  p_libvlc_media_release = (libvlc_media_release_t)LoadSym("libvlc_media_release");
  p_libvlc_media_player_new = (libvlc_media_player_new_t)LoadSym("libvlc_media_player_new");
  p_libvlc_media_player_new_from_media =
      (libvlc_media_player_new_from_media_t)LoadSym("libvlc_media_player_new_from_media");
  p_libvlc_media_player_set_media =
      (libvlc_media_player_set_media_t)LoadSym("libvlc_media_player_set_media");
  p_libvlc_media_player_release =
      (libvlc_media_player_release_t)LoadSym("libvlc_media_player_release");
  p_libvlc_media_player_play = (libvlc_media_player_play_t)LoadSym("libvlc_media_player_play");
  p_libvlc_media_player_pause = (libvlc_media_player_pause_t)LoadSym("libvlc_media_player_pause");
  p_libvlc_media_player_stop = (libvlc_media_player_stop_t)LoadSym("libvlc_media_player_stop");
  p_libvlc_media_player_is_playing =
      (libvlc_media_player_is_playing_t)LoadSym("libvlc_media_player_is_playing");
  p_libvlc_media_player_get_time =
      (libvlc_media_player_get_time_t)LoadSym("libvlc_media_player_get_time");
  p_libvlc_media_player_set_time =
      (libvlc_media_player_set_time_t)LoadSym("libvlc_media_player_set_time");
  p_libvlc_media_player_get_length =
      (libvlc_media_player_get_length_t)LoadSym("libvlc_media_player_get_length");
  p_libvlc_audio_set_volume = (libvlc_audio_set_volume_t)LoadSym("libvlc_audio_set_volume");
  p_libvlc_audio_get_volume = (libvlc_audio_get_volume_t)LoadSym("libvlc_audio_get_volume");
  p_libvlc_audio_get_track_description =
      (libvlc_audio_get_track_description_t)LoadSym("libvlc_audio_get_track_description");
  p_libvlc_audio_get_track = (libvlc_audio_get_track_t)LoadSym("libvlc_audio_get_track");
  p_libvlc_audio_set_track = (libvlc_audio_set_track_t)LoadSym("libvlc_audio_set_track");
  p_libvlc_track_description_list_release =
      (libvlc_track_description_list_release_t)LoadSym("libvlc_track_description_list_release");
  p_libvlc_video_get_spu_description =
      (libvlc_video_get_spu_description_t)LoadSym("libvlc_video_get_spu_description");
  p_libvlc_video_get_spu = (libvlc_video_get_spu_t)LoadSym("libvlc_video_get_spu");
  p_libvlc_video_set_spu = (libvlc_video_set_spu_t)LoadSym("libvlc_video_set_spu");
  p_libvlc_media_player_add_slave =
      (libvlc_media_player_add_slave_t)LoadSym("libvlc_media_player_add_slave");
  p_libvlc_media_player_event_manager =
      (libvlc_media_player_event_manager_t)LoadSym("libvlc_media_player_event_manager");
  p_libvlc_event_attach = (libvlc_event_attach_t)LoadSym("libvlc_event_attach");
  p_libvlc_event_detach = (libvlc_event_detach_t)LoadSym("libvlc_event_detach");

#define LOAD_OPT(fn) p_##fn = (fn##_t)LoadSym(#fn)
  LOAD_OPT(libvlc_get_version);
  LOAD_OPT(libvlc_get_compiler);
  LOAD_OPT(libvlc_get_changeset);
  LOAD_OPT(libvlc_free);
  LOAD_OPT(libvlc_media_add_option);
  LOAD_OPT(libvlc_media_get_duration);
  LOAD_OPT(libvlc_media_get_state);
  LOAD_OPT(libvlc_media_is_parsed);
  LOAD_OPT(libvlc_media_event_manager);
  LOAD_OPT(libvlc_media_get_meta);
  LOAD_OPT(libvlc_media_parse);
  LOAD_OPT(libvlc_media_parse_with_options);
  LOAD_OPT(libvlc_media_get_tracks_info);
  LOAD_OPT(libvlc_media_tracks_get);
  if (p_libvlc_media_tracks_get) {
    p_libvlc_media_tracks_release_v4 =
        (libvlc_media_tracks_release_v4_t)LoadSym("libvlc_media_tracks_release");
  } else {
    p_libvlc_media_tracks_release_v3 =
        (libvlc_media_tracks_release_v3_t)LoadSym("libvlc_media_tracks_release");
  }
  LOAD_OPT(libvlc_media_player_get_state);
  LOAD_OPT(libvlc_media_player_will_play);
  LOAD_OPT(libvlc_media_player_can_pause);
  LOAD_OPT(libvlc_media_player_set_pause);
  LOAD_OPT(libvlc_media_player_is_paused);
  LOAD_OPT(libvlc_media_player_is_seekable);
  LOAD_OPT(libvlc_media_player_has_vout);
  LOAD_OPT(libvlc_media_player_get_position);
  LOAD_OPT(libvlc_media_player_set_position);
  LOAD_OPT(libvlc_media_player_get_rate);
  LOAD_OPT(libvlc_media_player_set_rate);
  LOAD_OPT(libvlc_media_player_get_fps);
  LOAD_OPT(libvlc_media_player_get_chapter);
  LOAD_OPT(libvlc_media_player_set_chapter);
  LOAD_OPT(libvlc_media_player_get_chapter_count);
  LOAD_OPT(libvlc_media_player_get_chapter_description);
  LOAD_OPT(libvlc_media_player_get_title);
  LOAD_OPT(libvlc_media_player_set_title);
  LOAD_OPT(libvlc_media_player_get_title_count);
  LOAD_OPT(libvlc_media_player_get_title_description);
  LOAD_OPT(libvlc_media_player_next_chapter);
  LOAD_OPT(libvlc_media_player_previous_chapter);
  LOAD_OPT(libvlc_media_player_navigate);
  LOAD_OPT(libvlc_media_player_set_fullscreen);
  LOAD_OPT(libvlc_media_player_get_fullscreen);
  LOAD_OPT(libvlc_media_player_get_role);
  LOAD_OPT(libvlc_media_player_set_role);
  LOAD_OPT(libvlc_media_player_get_media);
  LOAD_OPT(libvlc_audio_toggle_mute);
  LOAD_OPT(libvlc_audio_get_mute);
  LOAD_OPT(libvlc_audio_set_mute);
  LOAD_OPT(libvlc_audio_get_channel);
  LOAD_OPT(libvlc_audio_set_channel);
  LOAD_OPT(libvlc_audio_get_delay);
  LOAD_OPT(libvlc_audio_set_delay);
  LOAD_OPT(libvlc_video_get_track);
  LOAD_OPT(libvlc_video_set_track);
  LOAD_OPT(libvlc_video_get_track_description);
  LOAD_OPT(libvlc_video_get_scale);
  LOAD_OPT(libvlc_video_set_scale);
  LOAD_OPT(libvlc_video_get_aspect_ratio);
  LOAD_OPT(libvlc_video_set_aspect_ratio);
  LOAD_OPT(libvlc_video_set_crop_geometry);
  LOAD_OPT(libvlc_video_get_size);
  LOAD_OPT(libvlc_video_get_deinterlace);
  LOAD_OPT(libvlc_video_set_deinterlace);
  LOAD_OPT(libvlc_video_take_snapshot);
#undef LOAD_OPT

#ifdef _WIN32
  p_libvlc_media_player_set_hwnd =
      (libvlc_media_player_set_hwnd_t)LoadSym("libvlc_media_player_set_hwnd");
#elif defined(__APPLE__)
  p_libvlc_media_player_set_nsobject =
      (libvlc_media_player_set_nsobject_t)LoadSym("libvlc_media_player_set_nsobject");
#else
  p_libvlc_media_player_set_xwindow =
      (libvlc_media_player_set_xwindow_t)LoadSym("libvlc_media_player_set_xwindow");
#endif

  if (!p_libvlc_new || !p_libvlc_media_player_new || !p_libvlc_media_player_set_media ||
      !p_libvlc_media_player_play) {
    if (error) *error = "Failed to resolve core libvlc exports";
    return false;
  }
#ifdef _WIN32
  if (!p_libvlc_media_player_set_hwnd) {
    if (error) *error = "libvlc_media_player_set_hwnd not found";
    return false;
  }
#elif defined(__APPLE__)
  if (!p_libvlc_media_player_set_nsobject) {
    if (error) *error = "libvlc_media_player_set_nsobject not found";
    return false;
  }
#else
  if (!p_libvlc_media_player_set_xwindow) {
    if (error) *error = "libvlc_media_player_set_xwindow not found";
    return false;
  }
#endif
  return true;
}

#ifdef _WIN32
std::wstring Utf8ToWide(const std::string &utf8) {
  if (utf8.empty()) return L"";
  int size = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, nullptr, 0);
  if (size <= 0) return L"";
  std::wstring out(static_cast<size_t>(size - 1), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, &out[0], size);
  return out;
}

std::string WideToUtf8(const std::wstring &wide) {
  if (wide.empty()) return "";
  int size = WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), -1, nullptr, 0, nullptr, nullptr);
  if (size <= 0) return "";
  std::string out(static_cast<size_t>(size - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), -1, &out[0], size, nullptr, nullptr);
  return out;
}
#endif

static std::string JoinPath(const std::string &dir, const char *name) {
#ifdef _WIN32
  if (dir.empty()) return name;
  if (dir.back() == '\\' || dir.back() == '/') return dir + name;
  return dir + "\\" + name;
#else
  if (dir.empty()) return name;
  if (dir.back() == '/') return dir + name;
  return dir + "/" + name;
#endif
}

static std::string NormalizeAvcodecHwImpl(const std::string &raw) {
  if (raw.empty()) return "none";
  std::string s = raw;
  for (char &c : s) {
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  }
  for (char c : s) {
    const bool ok =
        (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
    if (!ok) return "";
  }
  return s;
}

std::string NormalizeAvcodecHw(const std::string &raw) {
  return NormalizeAvcodecHwImpl(raw);
}

static int GetLibVlcMajorVersion() {
  if (!p_libvlc_get_version) return 0;
  const char *ver = p_libvlc_get_version();
  if (!ver || ver[0] == '\0') return 0;
  int major = 0;
  if (std::sscanf(ver, "%d", &major) == 1) return major;
  return 0;
}

bool LoadLibVlcFromDir(const std::string &vlcDirUtf8, const std::string &avcodecHw,
                       std::string *error) {
  g_vlc_dir = vlcDirUtf8;
  const std::string hw = NormalizeAvcodecHwImpl(avcodecHw);
  if (hw.empty()) {
    if (error) *error = "Invalid avcodec-hw value: " + avcodecHw;
    return false;
  }
  g_vlc_avcodec_hw = hw;

#ifdef _WIN32
  const std::wstring wideDir = Utf8ToWide(vlcDirUtf8);
  const std::wstring dllPath = wideDir + L"\\libvlc.dll";
  SetDllDirectoryW(wideDir.c_str());
  g_libvlc_module = LoadLibraryW(dllPath.c_str());
  if (!g_libvlc_module) {
    if (error) *error = "Failed to load libvlc.dll from: " + vlcDirUtf8;
    return false;
  }
#elif defined(__APPLE__)
  // VLC macOS 包将 dylib 放在 vlcDir/lib/；libvlc 经 @rpath 依赖 libvlccore，
  // 从 Electron 进程 dlopen 时 @rpath 不会指向 VLC，须先以绝对路径预载 libvlccore。
  static auto preloadLibVlcCore = [](const std::string &dir) {
    const char *names[] = {"libvlccore.dylib", "libvlccore.9.dylib"};
    for (const char *name : names) {
      const std::string corePath = JoinPath(dir, name);
      if (dlopen(corePath.c_str(), RTLD_LAZY | RTLD_GLOBAL) != nullptr) {
        return;
      }
    }
  };

  const std::string libSubDir = JoinPath(vlcDirUtf8, "lib");
  preloadLibVlcCore(vlcDirUtf8);
  preloadLibVlcCore(libSubDir);

  std::string libPath = JoinPath(vlcDirUtf8, "libvlc.dylib");
  g_libvlc_module = dlopen(libPath.c_str(), RTLD_LAZY | RTLD_GLOBAL);
  if (!g_libvlc_module) {
    libPath = JoinPath(libSubDir, "libvlc.dylib");
    g_libvlc_module = dlopen(libPath.c_str(), RTLD_LAZY | RTLD_GLOBAL);
  }
  if (!g_libvlc_module) {
    if (error) *error = std::string("Failed to load libvlc.dylib: ") + dlerror();
    return false;
  }
#else
  std::string libPath = JoinPath(vlcDirUtf8, "libvlc.so");
  g_libvlc_module = dlopen(libPath.c_str(), RTLD_LAZY | RTLD_GLOBAL);
  if (!g_libvlc_module) {
    libPath = JoinPath(vlcDirUtf8, "libvlc.so.5");
    g_libvlc_module = dlopen(libPath.c_str(), RTLD_LAZY | RTLD_GLOBAL);
  }
  if (!g_libvlc_module) {
    if (error) {
      *error = std::string("Failed to load libvlc.so: ") + (dlerror() ? dlerror() : "unknown");
    }
    return false;
  }
#endif

  if (!ResolveExports(error)) {
    UnloadLibVlc();
    return false;
  }

  const int vlcMajor = GetLibVlcMajorVersion();
  if (vlcMajor >= 4) {
    if (error) {
      const char *ver = p_libvlc_get_version();
      *error = std::string("VLC 4.x is not supported; please use VLC 3.0.x (detected version: ") +
                 (ver && ver[0] ? ver : "?") + ")";
    }
    UnloadLibVlc();
    return false;
  }

  const std::string pluginPath = JoinPath(vlcDirUtf8, "plugins");
  SetVlcPluginPathEnv(pluginPath);

  g_vlc_argv_storage.clear();
  g_vlc_argv_ptrs.clear();
  auto pushArg = [](const std::string &arg) {
    g_vlc_argv_storage.push_back(arg);
    g_vlc_argv_ptrs.push_back(g_vlc_argv_storage.back().c_str());
  };
  // VLC 4+ 已移除 --plugin-path，须用 VLC_PLUGIN_PATH（见 SetVlcPluginPathEnv）
  pushArg("--no-video-title-show");
  pushArg("--quiet");
  pushArg("--intf=dummy");
  pushArg("--avcodec-hw=" + hw);
#ifdef _WIN32
  pushArg("--vout=windows");
#endif

  g_vlc = p_libvlc_new(static_cast<int>(g_vlc_argv_ptrs.size()), g_vlc_argv_ptrs.data());
  if (!g_vlc) {
    g_vlc = p_libvlc_new(0, nullptr);
  }
  if (!g_vlc) {
    if (error) {
      *error = "libvlc_new failed (check VLC_PLUGIN_PATH and " + pluginPath + ")";
    }
    UnloadLibVlc();
    return false;
  }
  LibVlcDetectSeekApi();
  return true;
}

void UnloadLibVlc() {
  if (g_vlc && p_libvlc_release) {
    p_libvlc_release(g_vlc);
    g_vlc = nullptr;
  }
  ClearVlcPluginPathEnv();
#ifdef _WIN32
  if (g_libvlc_module) {
    FreeLibrary(static_cast<HMODULE>(g_libvlc_module));
    g_libvlc_module = nullptr;
  }
#else
  if (g_libvlc_module) {
    dlclose(g_libvlc_module);
    g_libvlc_module = nullptr;
  }
#endif
}

void AttachDrawable(libvlc_media_player_t *mp, void *child_handle) {
  if (!mp || !child_handle) return;
#ifdef _WIN32
  if (p_libvlc_media_player_set_hwnd) {
    p_libvlc_media_player_set_hwnd(mp, child_handle);
  }
#elif defined(__APPLE__)
  if (p_libvlc_media_player_set_nsobject) {
    p_libvlc_media_player_set_nsobject(mp, child_handle);
  }
#else
  if (p_libvlc_media_player_set_xwindow) {
    p_libvlc_media_player_set_xwindow(
        mp, static_cast<unsigned>(reinterpret_cast<uintptr_t>(child_handle)));
  }
#endif
}

void DetachDrawable(libvlc_media_player_t *mp) {
  if (!mp) return;
#ifdef _WIN32
  if (p_libvlc_media_player_set_hwnd) {
    p_libvlc_media_player_set_hwnd(mp, nullptr);
  }
#elif defined(__APPLE__)
  if (p_libvlc_media_player_set_nsobject) {
    p_libvlc_media_player_set_nsobject(mp, nullptr);
  }
#else
  if (p_libvlc_media_player_set_xwindow) {
    p_libvlc_media_player_set_xwindow(mp, 0);
  }
#endif
}

void LibVlcDetectSeekApi() {
  g_libvlc_seek_has_fast_param = false;
  if (GetLibVlcMajorVersion() >= 4) {
    g_libvlc_seek_has_fast_param = true;
  }
}

void LibVlcSetPlayerTime(libvlc_media_player_t *mp, long long t) {
  if (!mp || !p_libvlc_media_player_set_time) return;
  if (g_libvlc_seek_has_fast_param) {
    reinterpret_cast<libvlc_media_player_set_time_fast_t>(p_libvlc_media_player_set_time)(mp, t,
                                                                                          0);
    return;
  }
  p_libvlc_media_player_set_time(mp, t);
}

void LibVlcSetPlayerPosition(libvlc_media_player_t *mp, float pos) {
  if (!mp || !p_libvlc_media_player_set_position) return;
  if (g_libvlc_seek_has_fast_param) {
    reinterpret_cast<libvlc_media_player_set_position_fast_t>(p_libvlc_media_player_set_position)(
        mp, pos, 0);
    return;
  }
  p_libvlc_media_player_set_position(mp, pos);
}

void OnVlcEvent(const libvlc_event_t *event, void *userdata) {
  if (!event || !userdata) return;
  PlayerState *state = static_cast<PlayerState *>(userdata);
  if (!state->mp) return;
  switch (event->type) {
    case libvlc_MediaPlayerTimeChanged:
      if (event->u.media_player_time_changed.new_time >= 0) {
        state->time_ms = event->u.media_player_time_changed.new_time;
      } else if (p_libvlc_media_player_get_time) {
        state->time_ms = p_libvlc_media_player_get_time(state->mp);
      }
      break;
    case libvlc_MediaPlayerPositionChanged:
      if (state->length_ms > 0 && event->u.media_player_position_changed.new_position >= 0.f) {
        state->time_ms = static_cast<long long>(
            event->u.media_player_position_changed.new_position * state->length_ms);
      } else if (p_libvlc_media_player_get_time) {
        state->time_ms = p_libvlc_media_player_get_time(state->mp);
      }
      break;
    case libvlc_MediaPlayerLengthChanged:
      if (event->u.media_player_length_changed.new_length > 0) {
        state->length_ms = event->u.media_player_length_changed.new_length;
      } else if (p_libvlc_media_player_get_length) {
        state->length_ms = p_libvlc_media_player_get_length(state->mp);
      }
      break;
    case libvlc_MediaPlayerEndReached:
      state->time_ms = state->length_ms;
      break;
    default:
      break;
  }
}
