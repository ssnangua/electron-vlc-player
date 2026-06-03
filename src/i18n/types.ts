/** 播放器内置 UI 文案（overlay 控制条、轨菜单、字幕对话框等） */
export interface VlcPlayerStrings {
  hitAreaLabel: string;
  seekProgressLabel: string;
  playPauseLabel: string;
  previousMediaLabel: string;
  nextMediaLabel: string;
  seekPreviewLabel: string;
  seekPreviewGenerate: string;
  speedLabel: string;
  audioTracksLabel: string;
  subtitlesLabel: string;
  volumeLabel: string;
  volumeClickToMute: string;
  pageFullscreen: string;
  exitPageFullscreen: string;
  windowFullscreen: string;
  exitWindowFullscreen: string;
  noAudioTracks: string;
  noSubtitles: string;
  addSubtitleFile: string;
  disable: string;
  /** 无名称时的轨标签；含 `{id}` 占位符 */
  trackFallback: string;
  /** 附加在轨名后的禁用标记，如 ` (disabled)` */
  trackDisabledSuffix: string;
  addSubtitleDialogTitle: string;
  subtitleFileFilter: string;
  /** 文件对话框「全部文件」过滤器名称 */
  allFilesFilter: string;
}

/** 内置语言包标识（BCP 47） */
export type VlcPlayerLocale =
  | 'en'
  | 'zh-CN'
  | 'zh-TW'
  | 'ja'
  | 'ko'
  | 'de'
  | 'fr'
  | 'es'
  | 'pt-BR'
  | 'ru';
