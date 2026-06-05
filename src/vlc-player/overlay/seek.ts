import { getBinding } from '../../native';
import type { VlcPlayerHost } from '../host';

export class OverlaySeekController {
  overlayScrubSession = { active: false };
  overlaySeekSyncTimer: ReturnType<typeof setTimeout> | null = null;
  overlaySeekResumeTimer: ReturnType<typeof setTimeout> | null = null;
  overlaySeekSyncBlocked = false;
  overlaySeekTargetMs: number | null = null;
  overlaySeekSettlingUntil = 0;
  /** Brief pause-before-seek while playing; overlay should keep showing pause. */
  overlaySeekPauseForResume = false;

  constructor(private readonly host: VlcPlayerHost) {}

  normalizeSeekPosition(position: number): number | null {
    if (!Number.isFinite(position)) return null;
    let pos = position;
    if (pos >= 1) pos = 0.999;
    if (pos < 0) pos = 0;
    return pos;
  }

  targetMsFromPosition(pos: number): number {
    if (this.host.playerId < 0) return 0;
    try {
      const len = getBinding().getLength(this.host.playerId);
      if (len > 0) return this.host.clampSeekTimeMs(Math.floor(pos * len));
    } catch {
      // ignore
    }
    return 0;
  }

  /** 拖动过程中节流 seek（边播边预览；不屏蔽 time 事件，便于时间文字实时更新） */
  applyOverlaySeekScrubPosition(pos: number): void {
    this.host.markSeekGrace();
    getBinding().setPosition(this.host.playerId, pos);
  }

  beginOverlaySeekScrub(): void {
    if (this.host.playerId < 0) return;
    this.overlayScrubSession.active = true;
    this.overlaySeekTargetMs = null;
    this.overlaySeekSettlingUntil = 0;
  }

  scrubOverlayToPosition(position: number): void {
    if (!this.overlayScrubSession.active) return;
    const b = getBinding();
    if (!b.isSeekable(this.host.playerId)) return;
    const pos = this.normalizeSeekPosition(position);
    if (pos == null) return;
    this.applyOverlaySeekScrubPosition(pos);
  }

  /** 拖动预览：与悬停时间一致，直接用毫秒 seek，避免 ratio/进度条量化偏差 */
  scrubOverlayToMs(ms: number): void {
    if (!this.overlayScrubSession.active) return;
    const b = getBinding();
    if (!b.isSeekable(this.host.playerId)) return;
    const target = this.host.clampSeekTimeMs(ms);
    this.host.markSeekGrace();
    b.setTime(this.host.playerId, target);
  }

  /** 换源/销毁前终止 scrub 会话与 seek 定时器，避免延迟 IPC 打到新媒体 */
  cancelOverlaySeekSession(): void {
    this.overlayScrubSession.active = false;
    this.overlaySeekTargetMs = null;
    this.overlaySeekSettlingUntil = 0;
    this.overlaySeekSyncBlocked = false;
    this.overlaySeekPauseForResume = false;
    if (this.overlaySeekSyncTimer) {
      clearTimeout(this.overlaySeekSyncTimer);
      this.overlaySeekSyncTimer = null;
    }
    if (this.overlaySeekResumeTimer) {
      clearTimeout(this.overlaySeekResumeTimer);
      this.overlaySeekResumeTimer = null;
    }
  }

  /** 松手：不同步 seek，滑块由 overlay 从 getTime 拉回真实进度 */
  endOverlaySeekScrub(): void {
    this.overlayScrubSession.active = false;
    this.overlaySeekTargetMs = null;
    this.overlaySeekSettlingUntil = 0;
    if (this.overlaySeekSyncTimer) {
      clearTimeout(this.overlaySeekSyncTimer);
      this.overlaySeekSyncTimer = null;
    }
    this.overlaySeekSyncBlocked = false;
    if (this.host.destroyed || this.host.playerId < 0) return;
    this.host.pushStateProgress();
  }

  seekOverlayToMs(ms: number): void {
    const b = getBinding();
    if (!b.isSeekable(this.host.playerId)) return;
    const target = this.host.clampSeekTimeMs(ms);
    try {
      const len = b.getLength(this.host.playerId);
      if (len > 0) {
        const pos = Math.min(0.999, target / len);
        this.performOverlaySeek(() => b.setPosition(this.host.playerId, pos), target);
        return;
      }
    } catch {
      // ignore
    }
    this.performOverlaySeek(() => {
      b.setTime(this.host.playerId, target);
    }, target);
  }

  seekOverlayToPosition(position: number): void {
    const b = getBinding();
    if (!b.isSeekable(this.host.playerId)) return;
    const pos = this.normalizeSeekPosition(position);
    if (pos == null) return;
    this.performOverlaySeek(
      () => b.setPosition(this.host.playerId, pos),
      this.targetMsFromPosition(pos),
    );
  }

  /**
   * 非 scrub 场景（如快捷键步进）：播放中先暂停再 seek 再恢复，避免 H.264 回跳。
   */
  performOverlaySeek(seekFn: () => void, targetMs: number): void {
    const b = getBinding();
    if (!b.isSeekable(this.host.playerId)) return;
    this.host.markSeekGrace();
    this.overlaySeekTargetMs = targetMs;
    this.overlaySeekSettlingUntil = Date.now() + 600;
    this.armOverlaySeekSyncGuard(300);

    let resumeAfter = false;
    try {
      resumeAfter = b.isPlaying(this.host.playerId);
      if (resumeAfter) {
        this.overlaySeekPauseForResume = true;
        b.setPause(this.host.playerId, true);
      }
    } catch {
      // ignore
    }

    seekFn();

    const finish = (): void => {
      if (this.host.destroyed || this.host.playerId < 0) return;
      this.host.pushStateProgress();
    };

    if (resumeAfter) {
      if (this.overlaySeekResumeTimer) {
        clearTimeout(this.overlaySeekResumeTimer);
      }
      this.overlaySeekResumeTimer = setTimeout(() => {
        this.overlaySeekResumeTimer = null;
        if (this.host.destroyed || this.host.playerId < 0) return;
        try {
          b.setPause(this.host.playerId, false);
        } catch {
          // ignore
        }
        this.overlaySeekPauseForResume = false;
        finish();
      }, 80);
      return;
    }
    this.scheduleOverlayProgressAfterSeek();
  }

  armOverlaySeekSyncGuard(blockMs: number): void {
    this.overlaySeekSyncBlocked = true;
    if (this.overlaySeekSyncTimer) {
      clearTimeout(this.overlaySeekSyncTimer);
    }
    this.overlaySeekSyncTimer = setTimeout(() => {
      this.overlaySeekSyncBlocked = false;
      this.overlaySeekSyncTimer = null;
      if (this.host.destroyed || this.host.playerId < 0) return;
      this.host.pushStateProgress();
    }, blockMs);
  }

  /** seek 完成后从 libVLC 拉取进度刷新 overlay（延迟，避免与 setTime 同步事件重入） */
  scheduleOverlayProgressAfterSeek(): void {
    this.armOverlaySeekSyncGuard(200);
  }

  clearSeekTimers(): void {
    if (this.overlaySeekSyncTimer) {
      clearTimeout(this.overlaySeekSyncTimer);
      this.overlaySeekSyncTimer = null;
    }
    if (this.overlaySeekResumeTimer) {
      clearTimeout(this.overlaySeekResumeTimer);
      this.overlaySeekResumeTimer = null;
    }
  }
}
