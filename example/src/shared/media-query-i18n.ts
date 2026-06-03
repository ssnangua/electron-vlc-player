import type { ExampleUiStrings } from "./evp-api";

const QUERY_UI_KEYS: Record<string, keyof ExampleUiStrings> = {
  PLAYER_NOT_READY: "queryPlayerNotReady",
  MEDIA_NOT_PARSED: "queryMediaNotParsed",
  METADATA_UNAVAILABLE: "queryMetadataUnavailable",
  MEDIA_OPENING: "queryMediaOpening",
  TRACKS_SWITCHABLE_ONLY: "queryTracksSwitchableOnly",
  TRACKS_PARTIAL: "queryTracksPartial",
  STREAM_INFO_UNAVAILABLE: "queryStreamInfoUnavailable",
};

export function mediaQueryHint(
  code: string | undefined,
  ui: ExampleUiStrings,
): string | undefined {
  if (!code) return undefined;
  const key = QUERY_UI_KEYS[code];
  if (!key) return undefined;
  return ui[key];
}

export function formatHintLibvlcLoaded(ui: ExampleUiStrings, version: string): string {
  return ui.hintLibvlcLoaded.replace("{version}", version);
}

export function formatStreamRow(ui: ExampleUiStrings, index: number): string {
  return ui.streamRow.replace("{index}", String(index));
}

export function formatErrorInvalidFfmpegPath(ui: ExampleUiStrings, filePath: string): string {
  return ui.errorInvalidFfmpegPath.replace("{path}", filePath);
}

export function formatErrorInvalidPlaybackMode(ui: ExampleUiStrings, mode: string): string {
  return ui.errorInvalidPlaybackMode.replace("{mode}", mode);
}
