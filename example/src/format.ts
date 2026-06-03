import path from "node:path";

export function basename(filePath: string): string {
  return path.basename(filePath);
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export function durationTextFromLengthMs(lengthMs: number): string {
  return lengthMs > 0 ? formatMs(lengthMs) : "—";
}
