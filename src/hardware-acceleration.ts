/** libVLC `--avcodec-hw=` 常用取值（完整列表见 libVLC 文档） */
export const VLC_HARDWARE_ACCELERATION_MODES = [
  'none',
  'any',
  'd3d11va',
  'dxva2',
  'cuda',
  'vaapi',
  'videotoolbox',
  'vdpau',
  'drm',
] as const;

export type VlcHardwareAcceleration =
  | (typeof VLC_HARDWARE_ACCELERATION_MODES)[number]
  | (string & {});

/** 规范化并校验 `--avcodec-hw` 取值 */
export function normalizeHardwareAcceleration(value: string): string {
  const s = value.trim().toLowerCase();
  if (!s) {
    throw new Error('hardwareAcceleration must be a non-empty string');
  }
  if (!/^[a-z0-9_-]+$/.test(s)) {
    throw new Error(
      `Invalid hardwareAcceleration: ${value} (expected libVLC --avcodec-hw value, e.g. none, any, d3d11va)`,
    );
  }
  return s;
}
