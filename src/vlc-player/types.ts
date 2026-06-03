import type { VlcOverlayTrackItem } from '../types';

export interface ContainerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayPlaybackCache {
  lengthMs: number;
  timeMs: number;
  volume: number;
  muted: boolean;
  rate: number;
  fps: number;
}

export interface OverlayTrackCache {
  audioTracks: VlcOverlayTrackItem[];
  subtitleTracks: VlcOverlayTrackItem[];
  audioTrackId: number;
  subtitleTrackId: number;
}
