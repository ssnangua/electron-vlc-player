#pragma once

#include <cstdint>
#include <string>

typedef struct libvlc_instance_t libvlc_instance_t;
typedef struct libvlc_media_t libvlc_media_t;
typedef struct libvlc_media_player_t libvlc_media_player_t;
typedef struct libvlc_event_manager_t libvlc_event_manager_t;

typedef enum libvlc_track_type_t {
  libvlc_track_unknown = -1,
  libvlc_track_audio = 0,
  libvlc_track_video = 1,
  libvlc_track_text = 2,
} libvlc_track_type_t;

/** 与 libvlc 3.0.x / 4.x 头文件一致的 event 载荷布局（union 成员均从 u 偏移 0 起） */
struct libvlc_event_t {
  int type;
  void *p_obj;
  union {
    struct {
      float new_cache;
    } media_player_buffering;
    struct {
      int new_chapter;
    } media_player_chapter_changed;
    struct {
      float new_position;
    } media_player_position_changed;
    struct {
      int64_t new_time;
    } media_player_time_changed;
    struct {
      int64_t new_length;
    } media_player_length_changed;
    struct {
      libvlc_media_t *new_media;
    } media_player_media_changed;
    struct {
      libvlc_track_type_t i_type;
      int i_id;
    } media_player_es_changed;
    struct {
      libvlc_track_type_t i_type;
      const char *psz_unselected_id;
      const char *psz_selected_id;
    } media_player_es_selection_changed;
  } u;
};

typedef struct libvlc_track_description_t {
  int i_id;
  char *psz_name;
  struct libvlc_track_description_t *p_next;
} libvlc_track_description_t;

typedef enum libvlc_state_t {
  libvlc_NothingSpecial = 0,
  libvlc_Opening,
  libvlc_Buffering,
  libvlc_Playing,
  libvlc_Paused,
  libvlc_Stopped,
  libvlc_Ended,
  libvlc_Error
} libvlc_state_t;

typedef enum libvlc_event_e {
  libvlc_MediaParsedChanged = 0x8,
  libvlc_MediaPlayerBuffering = 0x103,
  libvlc_MediaPlayerPlaying = 0x104,
  libvlc_MediaPlayerPaused = 0x105,
  libvlc_MediaPlayerStopped = 0x106,
  /** VLC 3：EndReached；VLC 4 同值为 Stopping */
  libvlc_MediaPlayerEndReached = 0x109,
  libvlc_MediaPlayerEncounteredError = 0x10a,
  libvlc_MediaPlayerTimeChanged = 0x10b,
  libvlc_MediaPlayerPositionChanged = 0x10c,
  libvlc_MediaPlayerLengthChanged = 0x111,
  libvlc_MediaPlayerESSelected = 0x116,
} libvlc_event_e;

typedef enum libvlc_navigate_mode_t {
  libvlc_navigate_activate = 0,
  libvlc_navigate_up,
  libvlc_navigate_down,
  libvlc_navigate_left,
  libvlc_navigate_right,
  libvlc_navigate_popout,
} libvlc_navigate_mode_t;

typedef enum libvlc_media_player_role_t {
  libvlc_role_none = 0,
  libvlc_role_music,
  libvlc_role_video,
  libvlc_role_communication,
  libvlc_role_game,
  libvlc_role_notification,
  libvlc_role_animation,
  libvlc_role_education,
  libvlc_role_test,
} libvlc_media_player_role_t;

struct PlayerState {
  libvlc_media_player_t *mp = nullptr;
  libvlc_media_t *media = nullptr;
  void *browser_handle = nullptr;
  void *child_handle = nullptr;
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
  long long length_ms = 0;
  long long time_ms = 0;
  /** 已对 mp 调用过 set_hwnd；换片时勿重复绑定 */
  bool drawable_attached = false;
  /** 已发起异步 parse（timeout=0），避免重复调用 libvlc_media_parse_with_options */
  bool media_parse_started = false;
  /** 已向 JS 投递 mediaReady（每个 media 实例一次） */
  bool media_ready_signaled = false;
  /** 已绑定 libvlc_media_event_manager */
  bool media_events_attached = false;
  /** 子 HWND/View 是否显示 */
  bool embed_visible = true;
  /** 预览 player：叠在主画面下面，避免露出右下角 */
  bool embed_stack_below = false;
  /** 预览 player：允许布局在父窗客户端外（被裁剪不可见） */
  bool embed_offscreen = false;
};

extern libvlc_instance_t *g_vlc;
extern void *g_libvlc_module;
extern std::string g_vlc_dir;
/** 当前 libvlc 实例的 `--avcodec-hw` 取值（空表示尚未加载，等价于 none） */
extern std::string g_vlc_avcodec_hw;

typedef libvlc_instance_t *(*libvlc_new_t)(int, const char *const *);
typedef void (*libvlc_release_t)(libvlc_instance_t *);
typedef const char *(*libvlc_get_version_t)(void);
typedef const char *(*libvlc_get_compiler_t)(void);
typedef const char *(*libvlc_get_changeset_t)(void);
typedef void (*libvlc_free_t)(void *);

typedef libvlc_media_t *(*libvlc_media_new_path_t)(libvlc_instance_t *, const char *);
typedef libvlc_media_t *(*libvlc_media_new_location_t)(libvlc_instance_t *, const char *);
typedef void (*libvlc_media_release_t)(libvlc_media_t *);
typedef void (*libvlc_media_add_option_t)(libvlc_media_t *, const char *);
typedef long long (*libvlc_media_get_duration_t)(libvlc_media_t *);
typedef libvlc_state_t (*libvlc_media_get_state_t)(libvlc_media_t *);
typedef int (*libvlc_media_is_parsed_t)(libvlc_media_t *);
typedef enum libvlc_meta_t {
  libvlc_meta_Title,
  libvlc_meta_Artist,
  libvlc_meta_Genre,
  libvlc_meta_Copyright,
  libvlc_meta_Album,
  libvlc_meta_TrackNumber,
  libvlc_meta_Description,
  libvlc_meta_Rating,
  libvlc_meta_Date,
  libvlc_meta_Setting,
  libvlc_meta_URL,
  libvlc_meta_Language,
  libvlc_meta_NowPlaying,
  libvlc_meta_Publisher,
  libvlc_meta_EncodedBy,
  libvlc_meta_ArtworkURL,
  libvlc_meta_TrackID,
  libvlc_meta_TrackTotal,
  libvlc_meta_Director,
  libvlc_meta_Season,
  libvlc_meta_Episode,
  libvlc_meta_ShowName,
  libvlc_meta_Actors,
  libvlc_meta_AlbumArtist,
  libvlc_meta_DiscNumber,
  libvlc_meta_MAX
} libvlc_meta_t;
typedef char *(*libvlc_media_get_meta_t)(libvlc_media_t *, libvlc_meta_t);
typedef int (*libvlc_media_parse_t)(libvlc_media_t *);
typedef int (*libvlc_media_parse_with_options_t)(libvlc_media_t *, int timeout, int parse_flag);
typedef struct libvlc_media_track_info_t {
  libvlc_track_type_t i_type;
  int i_id;
  char *psz_codec;
  char *psz_original_fourcc;
  int i_profile;
  int i_level;
  int i_bitrate;
  char *psz_language;
  char *psz_description;
  union {
    struct {
      unsigned i_height;
      unsigned i_width;
    } video;
    struct {
      unsigned i_channels;
      unsigned i_rate;
    } audio;
  } u;
} libvlc_media_track_info_t;
typedef unsigned (*libvlc_media_get_tracks_info_t)(libvlc_media_t *, libvlc_media_track_info_t **);
typedef void (*libvlc_media_tracks_release_v3_t)(libvlc_media_track_info_t **);
/** VLC 4+ libvlc_media_track_t（与 3.x 的 track_info 布局不同） */
typedef struct libvlc_media_track_t {
  unsigned int i_codec;
  unsigned int i_original_fourcc;
  int i_id;
  libvlc_track_type_t i_type;
  int i_profile;
  int i_level;
  union {
    struct {
      unsigned int i_height;
      unsigned int i_width;
      unsigned int i_sar_num;
      unsigned int i_sar_den;
      unsigned int i_frame_rate_num;
      unsigned int i_frame_rate_den;
    } video;
    struct {
      unsigned int i_channels;
      unsigned int i_rate;
    } audio;
  } u;
  unsigned int i_bitrate;
  char *psz_language;
  char *psz_description;
  char *psz_codec_description;
} libvlc_media_track_t;
typedef size_t (*libvlc_media_tracks_get_t)(libvlc_media_t *, libvlc_media_track_t ***);
typedef void (*libvlc_media_tracks_release_v4_t)(libvlc_media_track_t **, size_t);

typedef libvlc_media_player_t *(*libvlc_media_player_new_t)(libvlc_instance_t *);
typedef libvlc_media_player_t *(*libvlc_media_player_new_from_media_t)(libvlc_media_t *);
typedef void (*libvlc_media_player_set_media_t)(libvlc_media_player_t *, libvlc_media_t *);
typedef void (*libvlc_media_player_release_t)(libvlc_media_player_t *);
typedef int (*libvlc_media_player_play_t)(libvlc_media_player_t *);
typedef void (*libvlc_media_player_pause_t)(libvlc_media_player_t *);
typedef void (*libvlc_media_player_stop_t)(libvlc_media_player_t *);
typedef libvlc_state_t (*libvlc_media_player_get_state_t)(libvlc_media_player_t *);
typedef int (*libvlc_media_player_will_play_t)(libvlc_media_player_t *);
typedef int (*libvlc_media_player_can_pause_t)(libvlc_media_player_t *);
typedef void (*libvlc_media_player_set_pause_t)(libvlc_media_player_t *, int);
typedef int (*libvlc_media_player_is_paused_t)(libvlc_media_player_t *);
typedef int (*libvlc_media_player_is_playing_t)(libvlc_media_player_t *);
typedef int (*libvlc_media_player_is_seekable_t)(libvlc_media_player_t *);
typedef int (*libvlc_media_player_has_vout_t)(libvlc_media_player_t *);
typedef float (*libvlc_media_player_get_position_t)(libvlc_media_player_t *);
typedef void (*libvlc_media_player_set_position_t)(libvlc_media_player_t *, float);
/** VLC 4+：第三参数 b_fast，0=精确 seek，1=关键帧快速 seek */
typedef int (*libvlc_media_player_set_time_fast_t)(libvlc_media_player_t *, long long, int);
typedef int (*libvlc_media_player_set_position_fast_t)(libvlc_media_player_t *, float, int);
typedef float (*libvlc_media_player_get_rate_t)(libvlc_media_player_t *);
typedef void (*libvlc_media_player_set_rate_t)(libvlc_media_player_t *, float);
typedef float (*libvlc_media_player_get_fps_t)(libvlc_media_player_t *);
typedef long long (*libvlc_media_player_get_time_t)(libvlc_media_player_t *);
typedef void (*libvlc_media_player_set_time_t)(libvlc_media_player_t *, long long);
typedef long long (*libvlc_media_player_get_length_t)(libvlc_media_player_t *);
typedef int (*libvlc_media_player_get_chapter_t)(libvlc_media_player_t *);
typedef void (*libvlc_media_player_set_chapter_t)(libvlc_media_player_t *, int);
typedef int (*libvlc_media_player_get_chapter_count_t)(libvlc_media_player_t *);
typedef libvlc_track_description_t *(*libvlc_media_player_get_chapter_description_t)(
    libvlc_media_player_t *, int);
typedef int (*libvlc_media_player_get_title_t)(libvlc_media_player_t *);
typedef void (*libvlc_media_player_set_title_t)(libvlc_media_player_t *, int);
typedef int (*libvlc_media_player_get_title_count_t)(libvlc_media_player_t *);
typedef libvlc_track_description_t *(*libvlc_media_player_get_title_description_t)(
    libvlc_media_player_t *, int title);
typedef void (*libvlc_media_player_next_chapter_t)(libvlc_media_player_t *);
typedef void (*libvlc_media_player_previous_chapter_t)(libvlc_media_player_t *);
typedef void (*libvlc_media_player_navigate_t)(libvlc_media_player_t *, unsigned);
typedef void (*libvlc_media_player_set_fullscreen_t)(libvlc_media_player_t *, int);
typedef int (*libvlc_media_player_get_fullscreen_t)(libvlc_media_player_t *);
typedef libvlc_media_player_role_t (*libvlc_media_player_get_role_t)(libvlc_media_player_t *);
typedef void (*libvlc_media_player_set_role_t)(libvlc_media_player_t *, libvlc_media_player_role_t);
typedef libvlc_media_t *(*libvlc_media_player_get_media_t)(libvlc_media_player_t *);
typedef void (*libvlc_audio_set_volume_t)(libvlc_media_player_t *, int);
typedef int (*libvlc_audio_get_volume_t)(libvlc_media_player_t *);
typedef void (*libvlc_audio_toggle_mute_t)(libvlc_media_player_t *);
typedef int (*libvlc_audio_get_mute_t)(libvlc_media_player_t *);
typedef void (*libvlc_audio_set_mute_t)(libvlc_media_player_t *, int);
typedef int (*libvlc_audio_get_channel_t)(libvlc_media_player_t *);
typedef void (*libvlc_audio_set_channel_t)(libvlc_media_player_t *, int);
typedef long long (*libvlc_audio_get_delay_t)(libvlc_media_player_t *);
typedef void (*libvlc_audio_set_delay_t)(libvlc_media_player_t *, long long);
typedef libvlc_track_description_t *(*libvlc_audio_get_track_description_t)(libvlc_media_player_t *);
typedef int (*libvlc_audio_get_track_t)(libvlc_media_player_t *);
typedef int (*libvlc_audio_set_track_t)(libvlc_media_player_t *, int);
typedef int (*libvlc_video_get_track_t)(libvlc_media_player_t *);
typedef int (*libvlc_video_set_track_t)(libvlc_media_player_t *, int);
typedef libvlc_track_description_t *(*libvlc_video_get_track_description_t)(libvlc_media_player_t *);
typedef float (*libvlc_video_get_scale_t)(libvlc_media_player_t *);
typedef void (*libvlc_video_set_scale_t)(libvlc_media_player_t *, float);
typedef char *(*libvlc_video_get_aspect_ratio_t)(libvlc_media_player_t *);
typedef void (*libvlc_video_set_aspect_ratio_t)(libvlc_media_player_t *, const char *);
typedef void (*libvlc_video_set_crop_geometry_t)(libvlc_media_player_t *, const char *);
typedef int (*libvlc_video_get_size_t)(libvlc_media_player_t *, unsigned, unsigned *,
                                       unsigned *);
typedef char *(*libvlc_video_get_deinterlace_t)(libvlc_media_player_t *);
typedef void (*libvlc_video_set_deinterlace_t)(libvlc_media_player_t *, const char *);
typedef int (*libvlc_video_take_snapshot_t)(libvlc_media_player_t *, unsigned, const char *,
                                            unsigned, unsigned);
typedef void (*libvlc_track_description_list_release_t)(libvlc_track_description_t *);
typedef libvlc_track_description_t *(*libvlc_video_get_spu_description_t)(libvlc_media_player_t *);
typedef int (*libvlc_video_get_spu_t)(libvlc_media_player_t *);
typedef int (*libvlc_video_set_spu_t)(libvlc_media_player_t *, int);
typedef int (*libvlc_media_player_add_slave_t)(libvlc_media_player_t *, int, const char *,
                                               unsigned int);
typedef libvlc_event_manager_t *(*libvlc_media_event_manager_t)(libvlc_media_t *);
typedef libvlc_event_manager_t *(*libvlc_media_player_event_manager_t)(libvlc_media_player_t *);
typedef int (*libvlc_event_attach_t)(libvlc_event_manager_t *, libvlc_event_e,
                                       void (*)(const libvlc_event_t *, void *), void *);
typedef void (*libvlc_event_detach_t)(libvlc_event_manager_t *, libvlc_event_e,
                                      void (*)(const libvlc_event_t *, void *), void *);
typedef void (*libvlc_media_player_set_hwnd_t)(libvlc_media_player_t *, void *);
typedef void (*libvlc_media_player_set_nsobject_t)(libvlc_media_player_t *, void *);
typedef void (*libvlc_media_player_set_xwindow_t)(libvlc_media_player_t *, unsigned);

extern libvlc_new_t p_libvlc_new;
extern libvlc_release_t p_libvlc_release;
extern libvlc_get_version_t p_libvlc_get_version;
extern libvlc_get_compiler_t p_libvlc_get_compiler;
extern libvlc_get_changeset_t p_libvlc_get_changeset;
extern libvlc_free_t p_libvlc_free;
extern libvlc_media_new_path_t p_libvlc_media_new_path;
extern libvlc_media_new_location_t p_libvlc_media_new_location;
extern libvlc_media_release_t p_libvlc_media_release;
extern libvlc_media_add_option_t p_libvlc_media_add_option;
extern libvlc_media_get_duration_t p_libvlc_media_get_duration;
extern libvlc_media_get_state_t p_libvlc_media_get_state;
extern libvlc_media_is_parsed_t p_libvlc_media_is_parsed;
extern libvlc_media_get_meta_t p_libvlc_media_get_meta;
extern libvlc_media_parse_t p_libvlc_media_parse;
extern libvlc_media_parse_with_options_t p_libvlc_media_parse_with_options;
extern libvlc_media_get_tracks_info_t p_libvlc_media_get_tracks_info;
extern libvlc_media_tracks_get_t p_libvlc_media_tracks_get;
extern libvlc_media_tracks_release_v3_t p_libvlc_media_tracks_release_v3;
extern libvlc_media_tracks_release_v4_t p_libvlc_media_tracks_release_v4;
extern libvlc_media_player_new_t p_libvlc_media_player_new;
extern libvlc_media_player_new_from_media_t p_libvlc_media_player_new_from_media;
extern libvlc_media_player_set_media_t p_libvlc_media_player_set_media;
extern libvlc_media_player_release_t p_libvlc_media_player_release;
extern libvlc_media_player_play_t p_libvlc_media_player_play;
extern libvlc_media_player_pause_t p_libvlc_media_player_pause;
extern libvlc_media_player_stop_t p_libvlc_media_player_stop;
extern libvlc_media_player_get_state_t p_libvlc_media_player_get_state;
extern libvlc_media_player_will_play_t p_libvlc_media_player_will_play;
extern libvlc_media_player_can_pause_t p_libvlc_media_player_can_pause;
extern libvlc_media_player_set_pause_t p_libvlc_media_player_set_pause;
extern libvlc_media_player_is_paused_t p_libvlc_media_player_is_paused;
extern libvlc_media_player_is_playing_t p_libvlc_media_player_is_playing;
extern libvlc_media_player_is_seekable_t p_libvlc_media_player_is_seekable;
extern libvlc_media_player_has_vout_t p_libvlc_media_player_has_vout;
extern libvlc_media_player_get_position_t p_libvlc_media_player_get_position;
extern libvlc_media_player_set_position_t p_libvlc_media_player_set_position;
extern libvlc_media_player_get_rate_t p_libvlc_media_player_get_rate;
extern libvlc_media_player_set_rate_t p_libvlc_media_player_set_rate;
extern libvlc_media_player_get_fps_t p_libvlc_media_player_get_fps;
extern libvlc_media_player_get_time_t p_libvlc_media_player_get_time;
extern libvlc_media_player_set_time_t p_libvlc_media_player_set_time;
extern libvlc_media_player_get_length_t p_libvlc_media_player_get_length;
extern libvlc_media_player_get_chapter_t p_libvlc_media_player_get_chapter;
extern libvlc_media_player_set_chapter_t p_libvlc_media_player_set_chapter;
extern libvlc_media_player_get_chapter_count_t p_libvlc_media_player_get_chapter_count;
extern libvlc_media_player_get_chapter_description_t p_libvlc_media_player_get_chapter_description;
extern libvlc_media_player_get_title_t p_libvlc_media_player_get_title;
extern libvlc_media_player_set_title_t p_libvlc_media_player_set_title;
extern libvlc_media_player_get_title_count_t p_libvlc_media_player_get_title_count;
extern libvlc_media_player_get_title_description_t p_libvlc_media_player_get_title_description;
extern libvlc_media_player_next_chapter_t p_libvlc_media_player_next_chapter;
extern libvlc_media_player_previous_chapter_t p_libvlc_media_player_previous_chapter;
extern libvlc_media_player_navigate_t p_libvlc_media_player_navigate;
extern libvlc_media_player_set_fullscreen_t p_libvlc_media_player_set_fullscreen;
extern libvlc_media_player_get_fullscreen_t p_libvlc_media_player_get_fullscreen;
extern libvlc_media_player_get_role_t p_libvlc_media_player_get_role;
extern libvlc_media_player_set_role_t p_libvlc_media_player_set_role;
extern libvlc_media_player_get_media_t p_libvlc_media_player_get_media;
extern libvlc_audio_set_volume_t p_libvlc_audio_set_volume;
extern libvlc_audio_get_volume_t p_libvlc_audio_get_volume;
extern libvlc_audio_toggle_mute_t p_libvlc_audio_toggle_mute;
extern libvlc_audio_get_mute_t p_libvlc_audio_get_mute;
extern libvlc_audio_set_mute_t p_libvlc_audio_set_mute;
extern libvlc_audio_get_channel_t p_libvlc_audio_get_channel;
extern libvlc_audio_set_channel_t p_libvlc_audio_set_channel;
extern libvlc_audio_get_delay_t p_libvlc_audio_get_delay;
extern libvlc_audio_set_delay_t p_libvlc_audio_set_delay;
extern libvlc_video_get_track_t p_libvlc_video_get_track;
extern libvlc_video_set_track_t p_libvlc_video_set_track;
extern libvlc_video_get_track_description_t p_libvlc_video_get_track_description;
extern libvlc_video_get_scale_t p_libvlc_video_get_scale;
extern libvlc_video_set_scale_t p_libvlc_video_set_scale;
extern libvlc_video_get_aspect_ratio_t p_libvlc_video_get_aspect_ratio;
extern libvlc_video_set_aspect_ratio_t p_libvlc_video_set_aspect_ratio;
extern libvlc_video_set_crop_geometry_t p_libvlc_video_set_crop_geometry;
extern libvlc_video_get_size_t p_libvlc_video_get_size;
extern libvlc_video_get_deinterlace_t p_libvlc_video_get_deinterlace;
extern libvlc_video_set_deinterlace_t p_libvlc_video_set_deinterlace;
extern libvlc_video_take_snapshot_t p_libvlc_video_take_snapshot;
extern libvlc_audio_get_track_description_t p_libvlc_audio_get_track_description;
extern libvlc_audio_get_track_t p_libvlc_audio_get_track;
extern libvlc_audio_set_track_t p_libvlc_audio_set_track;
extern libvlc_track_description_list_release_t p_libvlc_track_description_list_release;
extern libvlc_video_get_spu_description_t p_libvlc_video_get_spu_description;
extern libvlc_video_get_spu_t p_libvlc_video_get_spu;
extern libvlc_video_set_spu_t p_libvlc_video_set_spu;
extern libvlc_media_player_add_slave_t p_libvlc_media_player_add_slave;
extern libvlc_media_event_manager_t p_libvlc_media_event_manager;
extern libvlc_media_player_event_manager_t p_libvlc_media_player_event_manager;
extern libvlc_event_attach_t p_libvlc_event_attach;
extern libvlc_event_detach_t p_libvlc_event_detach;
extern libvlc_media_player_set_hwnd_t p_libvlc_media_player_set_hwnd;
extern libvlc_media_player_set_nsobject_t p_libvlc_media_player_set_nsobject;
extern libvlc_media_player_set_xwindow_t p_libvlc_media_player_set_xwindow;

bool LoadLibVlcFromDir(const std::string &vlcDirUtf8, const std::string &avcodecHw, std::string *error);
/** 规范化 `--avcodec-hw` 取值；非法时返回空字符串 */
std::string NormalizeAvcodecHw(const std::string &raw);
void UnloadLibVlc();
/** libvlc_new 成功后调用，检测 VLC 4 精确 seek API */
void LibVlcDetectSeekApi();
void LibVlcSetPlayerTime(libvlc_media_player_t *mp, long long t);
void LibVlcSetPlayerPosition(libvlc_media_player_t *mp, float pos);
void AttachDrawable(libvlc_media_player_t *mp, void *child_handle);
void DetachDrawable(libvlc_media_player_t *mp);
void OnVlcEvent(const libvlc_event_t *event, void *userdata);

#ifdef _WIN32
std::wstring Utf8ToWide(const std::string &utf8);
std::string WideToUtf8(const std::wstring &wide);
#endif
