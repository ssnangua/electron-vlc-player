export interface PlaylistItem {
  path: string;
  title: string;
  /** 列表「时长」列；未解析前为空 */
  durationText?: string;
}

export interface MediaStreamView {
  type: string;
  codec?: string;
  language?: string;
  description?: string;
  details?: string;
}

export interface MediaInfoView {
  path: string | null;
  /** 窗口/面板显示名：元数据标题，否则为文件名 */
  title?: string;
  filename?: string;
  artist?: string;
  album?: string;
  genre?: string;
  stateLabel?: string;
  durationText?: string;
  resolution?: string;
  fps?: number;
  streams?: MediaStreamView[];
  /** 库返回的简要说明（如尚未 parse、无法读取详细轨时的退回说明） */
  notice?: string;
}

export interface ExampleUiStrings {
  openMedia: string;
  pickVlcDirTitle: string;
  vlcDirPlaceholder: string;
  pickFfmpegTitle: string;
  ffmpegPlaceholder: string;
  switchLocale: string;
  loopModeTitle: string;
  playlistTitle: string;
  playlistDuration: string;
  playlistEmpty: string;
  addMedia: string;
  clearPlaylist: string;
  loopDefault: string;
  loopList: string;
  loopRepeat: string;
  noMediaLoaded: string;
  removePlaylistItem: string;
  sidebarResizeLabel: string;
  bottomBarResizeLabel: string;
  playFailedPrefix: string;
  openMediaFailedPrefix: string;
  labelTitle: string;
  labelArtist: string;
  labelAlbum: string;
  labelGenre: string;
  labelPath: string;
  labelDuration: string;
  labelResolution: string;
  labelFps: string;
  labelNotice: string;
  pickFfmpegDialogTitle: string;
  pickFfmpegFilterExec: string;
  pickFfmpegFilterAll: string;
  pickOpenVideoTitle: string;
  pickAddVideosTitle: string;
  filterMedia: string;
  filterVideo: string;
  filterAudio: string;
  filterPlaylist: string;
  filterAll: string;
  noticeSetupVlc: string;
}

export interface LocaleOption {
  id: string;
  label: string;
}

/** 当前 locale 与对应 UI 文案（由 main 从语言包解析后下发给 renderer） */
export interface LocaleView {
  locale: string;
  ui: ExampleUiStrings;
  localeOptions: LocaleOption[];
}

export interface EvpState {
  vlcDir: string;
  ffmpegPath: string;
  playbackMode: "default" | "loop" | "repeat";
  playlist: PlaylistItem[];
  currentPath: string | null;
  locale: string;
  ui: ExampleUiStrings;
  localeOptions: LocaleOption[];
  mediaInfo: MediaInfoView;
}

export interface EvpLayoutBridge {
  notify: () => void;
}

export interface StoredPlaylist {
  playlist: PlaylistItem[];
  currentPath: string | null;
}

export interface EvpBridge {
  getState: () => Promise<EvpState>;
  pickVlcDir: () => Promise<string | null>;
  pickFfmpegPath: () => Promise<string | null>;
  pickOpenVideo: () => Promise<void>;
  pickAddVideos: () => Promise<void>;
  playPath: (filePath: string) => Promise<void>;
  setVlcDir: (dir: string) => Promise<void>;
  setFfmpegPath: (path: string) => Promise<void>;
  clearPlaylist: () => Promise<void>;
  removePlaylistItem: (filePath: string) => Promise<void>;
  showPlaylistItemMenu: (filePath: string, x: number, y: number) => Promise<void>;
  setPlaybackMode: (mode: "default" | "loop" | "repeat") => Promise<void>;
  setLocale: (locale: string) => Promise<LocaleView>;
  restorePlaylist: (data: StoredPlaylist) => Promise<void>;
  addMediaPaths: (filePaths: string[]) => Promise<void>;
  onPlaylist: (callback: (data: { playlist: PlaylistItem[]; currentPath: string | null }) => void) => void;
  onMediaInfo: (callback: (info: MediaInfoView) => void) => void;
  onLocaleChanged: (callback: (view: LocaleView) => void) => void;
}
