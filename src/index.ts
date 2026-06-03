export {
  detectSystemLocale,
  formatTrackFallback,
  getPlayerStrings,
  resolvePlayerLocale,
  SUPPORTED_PLAYER_LOCALES,
} from './i18n';
export type { VlcPlayerLocale, VlcPlayerStrings } from './i18n';
export { VlcPlayer } from './vlc-player';
export { LibVLC, getLibVlcVersion } from './libvlc';
export {
  MediaQueryCode,
  type MediaParsedResult,
  type MediaMetadataResult,
  type MediaTracksResult,
  type MediaQueryResult,
  type MediaProbeResult,
} from './types';
export {
  getBinding,
  initLibVlc,
  probeMedia,
  getHardwareAcceleration,
  setHardwareAcceleration,
} from './native';
export {
  normalizeHardwareAcceleration,
  VLC_HARDWARE_ACCELERATION_MODES,
} from './hardware-acceleration';
export type { VlcHardwareAcceleration } from './hardware-acceleration';
export { resolveVlcDir, probeDefaultVlcDir } from './vlc-path';
export {
  isLocalMediaSource,
  probeDefaultFfmpegPath,
  previewMediaKeyFromSource,
  resolveFfmpegExecutable,
} from './seek-preview-sprite';
export type { SeekPreviewSpriteIndex } from './seek-preview-sprite';
export { VlcState, VlcNavigate, VlcRole, VlcEvent, VlcTrackType } from './vlc-constants';
export { VlcEventName, vlcEventName } from './vlc-event-names';
export type { VlcEventNameValue } from './vlc-event-names';
export type {
  VlcPlayerOptions,
  VlcSetSourceOptions,
  VlcPlaybackMode,
  VlcPlayerEventPayload,
  VlcPlaylistItemChangedPayload,
  VlcOverlayContextMenuPayload,
  VlcOverlayTrackItem,
  VlcOpenSubtitlePayload,
  VlcTrackKind,
  VlcTrackChangedPayload,
} from './types';
export type {
  TrackInfo,
  LibVlcVersionInfo,
  MediaInfo,
  MediaMetadata,
  MediaStreamInfo,
  VideoSize,
  VlcBinding,
} from './native';
