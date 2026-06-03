/** libvlc_state_t */
export const VlcState = {
  NothingSpecial: 0,
  Opening: 1,
  Buffering: 2,
  Playing: 3,
  Paused: 4,
  Stopped: 5,
  Ended: 6,
  Error: 7,
} as const;

export type VlcStateValue = (typeof VlcState)[keyof typeof VlcState];

/** libvlc_navigate_mode_t */
export const VlcNavigate = {
  Activate: 0,
  Up: 1,
  Down: 2,
  Left: 3,
  Right: 4,
  Popout: 5,
} as const;

/** libvlc_media_player_role_t */
export const VlcRole = {
  None: 0,
  Music: 1,
  Video: 2,
  Communication: 3,
  Game: 4,
  Notification: 5,
  Animation: 6,
  Education: 7,
  Test: 8,
} as const;

/** libvlc_event_e（媒体 + 播放器子集） */
export const VlcEvent = {
  /** libvlc_MediaParsedChanged（由 `parseMedia()` 内部使用，不对外 emit） */
  MediaParsedChanged: 0x8,
  MediaPlayerBuffering: 0x103,
  MediaPlayerPlaying: 0x104,
  MediaPlayerPaused: 0x105,
  MediaPlayerStopped: 0x106,
  /** VLC 3：EndReached；VLC 4 同值为 Stopping */
  MediaPlayerEndReached: 0x109,
  MediaPlayerEncounteredError: 0x10a,
  MediaPlayerTimeChanged: 0x10b,
  MediaPlayerPositionChanged: 0x10c,
  MediaPlayerLengthChanged: 0x111,
  /** 音/视/字幕轨选中变化 → `audioTrackChanged` / `videoTrackChanged` / `subtitleTrackChanged` */
  MediaPlayerESSelected: 0x116,
} as const;

/** libvlc_track_type_t（与 native `trackType` 字段一致） */
export const VlcTrackType = {
  Audio: 0,
  Video: 1,
  Subtitle: 2,
} as const;
