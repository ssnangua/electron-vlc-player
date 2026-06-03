import fs from 'node:fs';
import path from 'node:path';

const LIBVLC_NAMES: Record<string, string[]> = {
  win32: ['libvlc.dll'],
  darwin: ['libvlc.dylib'],
  linux: ['libvlc.so', 'libvlc.so.5'],
};

function libVlcProbeCandidates(): string[] {
  switch (process.platform) {
    case 'win32': {
      const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
      const programFilesX86 =
        process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
      return [
        path.join(programFiles, 'VideoLAN', 'VLC'),
        path.join(programFilesX86, 'VideoLAN', 'VLC'),
      ];
    }
    case 'darwin':
      return ['/Applications/VLC.app/Contents/MacOS'];
    case 'linux':
      return [
        '/usr/lib/x86_64-linux-gnu',
        '/usr/lib/aarch64-linux-gnu',
        '/usr/lib',
        '/usr/local/lib',
      ];
    default:
      return [];
  }
}

function hasLibVlcAt(dir: string): boolean {
  const candidates = LIBVLC_NAMES[process.platform];
  if (!candidates) return false;
  return candidates.some((name) => fs.existsSync(path.join(dir, name)));
}

/**
 * 校验并规范化 libVLC 根目录（须包含平台对应的 libvlc 库文件）。
 * 不会自动探测；可选用 {@link probeDefaultVlcDir} 探测常见安装路径后再传入 `vlcDir`。
 */
export function resolveVlcDir(vlcDir: string): string {
  const trimmed = vlcDir?.trim();
  if (!trimmed) {
    throw new Error('vlcDir is required');
  }

  const normalized = path.resolve(trimmed);
  const candidates = LIBVLC_NAMES[process.platform];
  if (!candidates) {
    throw new Error(`Unsupported platform for libVLC: ${process.platform}`);
  }

  for (const name of candidates) {
    const lib = path.join(normalized, name);
    if (fs.existsSync(lib)) {
      return normalized;
    }
  }

  throw new Error(
    `libvlc not found in ${normalized} (expected one of: ${candidates.join(', ')})`,
  );
}

/** 可选探测：各平台常见 VLC / libVLC 安装路径。库本身不会调用；集成方自行调用后传入 `vlcDir`。 */
export function probeDefaultVlcDir(): string | null {
  for (const candidate of libVlcProbeCandidates()) {
    if (!hasLibVlcAt(candidate)) continue;
    try {
      return resolveVlcDir(candidate);
    } catch {
      // 继续尝试下一个候选路径
    }
  }
  return null;
}
