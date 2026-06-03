import path from 'node:path';

/**
 * overlay 静态资源目录（controls.html、preload.js 等）。
 * 位于包根 `overlay/`，与 `dist/` 同级；勿相对 vlc-player 子目录拼路径。
 */
export function resolveOverlayDir(): string {
  return path.join(__dirname, '..', 'overlay');
}
