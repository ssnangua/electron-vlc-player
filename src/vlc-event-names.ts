import { VlcEvent } from './vlc-constants';

/** libVLC 事件类型 → 推荐监听名 */
export const VlcEventName = {
  [VlcEvent.MediaPlayerTimeChanged]: 'timeChanged',
  [VlcEvent.MediaPlayerPositionChanged]: 'positionChanged',
  [VlcEvent.MediaPlayerLengthChanged]: 'lengthChanged',
  [VlcEvent.MediaPlayerEndReached]: 'endReached',
  [VlcEvent.MediaPlayerPlaying]: 'playing',
  [VlcEvent.MediaPlayerPaused]: 'paused',
  [VlcEvent.MediaPlayerStopped]: 'stopped',
  [VlcEvent.MediaPlayerBuffering]: 'buffering',
  [VlcEvent.MediaPlayerEncounteredError]: 'error',
} as const;

export type VlcEventNameValue = (typeof VlcEventName)[keyof typeof VlcEventName];

export function vlcEventName(type: number): string {
  return (VlcEventName as Record<number, string>)[type] ?? `vlc:0x${type.toString(16)}`;
}
