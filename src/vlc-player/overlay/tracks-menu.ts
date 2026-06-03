import type { MediaStreamInfo } from '../../native';
import { formatTrackFallback } from '../../i18n';
import type { VlcPlayerStrings } from '../../i18n/types';
import type { VlcOverlayTrackItem } from '../../types';
import type { VlcPlayerHost } from '../host';
import type { OverlayTrackCache } from '../types';

export function formatMenuLabel(name: string, id: number, strings: VlcPlayerStrings): string {
  const label = name?.trim() || formatTrackFallback(strings, id);
  return id < 0 ? `${label}${strings.trackDisabledSuffix}` : label;
}

export class OverlayTracksMenuController {
  constructor(private readonly host: VlcPlayerHost) {}

  /** 控制条弹层：音轨/字幕列表与当前选中 id */
  getOverlayTrackState(): OverlayTrackCache {
    const empty: OverlayTrackCache = {
      audioTracks: [],
      subtitleTracks: [],
      audioTrackId: -1,
      subtitleTrackId: -1,
    };
    if (this.host.playerId < 0) return empty;
    const strings = this.host.strings;
    try {
      const audioRaw = this.listContextMenuTracks('audio');
      const subtitleRaw = this.listContextMenuTracks('subtitle');
      const audioTracks: VlcOverlayTrackItem[] = audioRaw.map((t) => ({
        id: t.id,
        label: formatMenuLabel(t.name, t.id, strings),
      }));
      const subtitleTracks: VlcOverlayTrackItem[] = subtitleRaw.map((t) => ({
        id: t.id,
        label: t.id < 0 ? strings.disable : formatMenuLabel(t.name, t.id, strings),
      }));
      return {
        audioTracks,
        subtitleTracks,
        audioTrackId: this.resolveContextMenuCurrentTrack(audioRaw, this.host.getAudioTrack()),
        subtitleTrackId: this.resolveContextMenuCurrentTrack(
          subtitleRaw,
          this.host.getSubtitleTrack(),
        ),
      };
    } catch {
      return empty;
    }
  }

  /** 轨列表标签（与 parseMedia 轨信息一致） */
  mediaTrackMenuLabel(stream: MediaStreamInfo): string {
    const parts = [stream.codec, stream.language, stream.description]
      .map((s) => s?.trim())
      .filter(Boolean) as string[];
    const joined = parts.join(' · ');
    return joined || formatTrackFallback(this.host.strings, stream.id);
  }

  /**
   * 合并播放器可切换轨（track_description）与媒体解析轨（parseMedia / getMediaTracks）。
   * 嵌入场景下 getAudioTracks 有时只剩 id=-1「禁用」，而底栏仍能从媒体轨看到「轨道 1」。
   */
  listContextMenuTracks(kind: 'audio' | 'subtitle'): { id: number; name: string }[] {
    const playerList =
      kind === 'audio' ? this.host.getAudioTracks() : this.host.getSubtitleTracks();
    const realFromPlayer = playerList.filter((t) => t.id >= 0);

    if (realFromPlayer.length > 0) {
      if (kind === 'subtitle') {
        return [...realFromPlayer, ...playerList.filter((t) => t.id < 0)];
      }
      return realFromPlayer;
    }

    const fromMedia = this.host
      .getMediaTracksResult()
      .data.filter((t) => t.type === kind && t.id >= 0)
      .map((t) => ({ id: t.id, name: this.mediaTrackMenuLabel(t as MediaStreamInfo) }));

    if (fromMedia.length > 0) {
      if (kind === 'subtitle') {
        return [...fromMedia, ...playerList.filter((t) => t.id < 0)];
      }
      return fromMedia;
    }

    return playerList;
  }

  /** libvlc 返回 -1 但仅有一条可播轨时，菜单选中项与底栏一致 */
  resolveContextMenuCurrentTrack(
    tracks: { id: number; name: string }[],
    reported: number,
  ): number {
    if (tracks.some((t) => t.id === reported)) return reported;
    const playable = tracks.filter((t) => t.id >= 0);
    if (reported < 0 && playable.length === 1) return playable[0].id;
    return reported;
  }
}
