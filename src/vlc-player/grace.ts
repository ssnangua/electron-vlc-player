import type { VlcPlayerHost } from './host';

export class GraceController {
  suppressEndReachedUntil = 0;
  sourceChangeInProgress = false;
  sourceChangeGraceTimer: NodeJS.Timeout | null = null;
  suppressOverlayProgressUntil = 0;

  constructor(private readonly host: VlcPlayerHost) {}

  suppressEndReached(ms: number): void {
    const until = Date.now() + ms;
    if (until > this.suppressEndReachedUntil) {
      this.suppressEndReachedUntil = until;
    }
  }

  markSeekGrace(): void {
    this.suppressEndReached(1200);
  }

  /** setSource 内部会先 stop 再 set_media，异步 endReached 不应视为播完 */
  markSourceChangeGrace(): void {
    this.suppressEndReached(1500);
    this.sourceChangeInProgress = true;
    if (this.sourceChangeGraceTimer) {
      clearTimeout(this.sourceChangeGraceTimer);
    }
    this.sourceChangeGraceTimer = setTimeout(() => {
      this.sourceChangeGraceTimer = null;
      this.sourceChangeInProgress = false;
    }, 1500);
    const until = Date.now() + 1500;
    if (until > this.suppressOverlayProgressUntil) {
      this.suppressOverlayProgressUntil = until;
    }
  }

  clearSourceChangeGraceTimer(): void {
    if (this.sourceChangeGraceTimer) {
      clearTimeout(this.sourceChangeGraceTimer);
      this.sourceChangeGraceTimer = null;
    }
    this.sourceChangeInProgress = false;
  }
}
