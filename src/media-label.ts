import path from 'node:path';

/** 从本地路径或 URL 取展示用文件名 */
export function mediaFilenameFromSource(src: string): string {
  const trimmed = src.trim();
  if (!trimmed) return '';
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const u = new URL(trimmed);
      const seg = u.pathname.split('/').filter(Boolean).pop();
      if (seg) return decodeURIComponent(seg);
    }
  } catch {
    // ignore
  }
  return path.basename(trimmed);
}

/** 全屏标题：有有效 title 时只显示 title，否则显示文件名 */
export function formatMediaDisplayLabel(
  source: string | null | undefined,
  title?: string | null,
): string {
  if (!source?.trim()) return '';
  const filename = mediaFilenameFromSource(source);
  const t = title?.trim();
  if (t && t !== filename) return t;
  return filename;
}
