import fs from 'node:fs';
import path from 'node:path';
import { protocol, session } from 'electron';

let schemeRegistered = false;
let protocolRegistered = false;
let protocolCacheRoot = '';

/** 须在 app.ready 之前调用（随 VlcPlayer 模块加载即可） */
export function registerSeekPreviewScheme(): void {
  if (schemeRegistered) return;
  try {
    protocol.registerSchemesAsPrivileged([
      {
        scheme: 'evp-preview',
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
          stream: true,
        },
      },
    ]);
  } catch {
    // 重复注册时忽略
  }
  schemeRegistered = true;
}

export function updateSeekPreviewProtocolCacheRoot(cacheRoot: string): void {
  protocolCacheRoot = path.resolve(cacheRoot);
}

function resolvePreviewFilePath(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'evp-preview:') return null;
    if (u.hostname !== 'sprite') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length !== 2 || parts[1] !== 'sprite.jpg') return null;
    const mediaKey = decodeURIComponent(parts[0]);
    if (!mediaKey || mediaKey.includes('..') || mediaKey.includes('/') || mediaKey.includes('\\')) {
      return null;
    }
    if (!protocolCacheRoot) return null;
    const abs = path.join(protocolCacheRoot, mediaKey, 'sprite.jpg');
    const root = path.resolve(protocolCacheRoot);
    if (!abs.startsWith(root + path.sep) && abs !== root) return null;
    return abs;
  } catch {
    return null;
  }
}

/** 将缓存目录下的雪碧图以 evp-preview:// 提供给 overlay */
export function registerSeekPreviewProtocol(): void {
  if (protocolRegistered) return;
  registerSeekPreviewScheme();
  session.defaultSession.protocol.registerFileProtocol('evp-preview', (request, callback) => {
    const filePath = resolvePreviewFilePath(request.url);
    if (!filePath || !fs.existsSync(filePath)) {
      callback({ error: -6 });
      return;
    }
    callback({ path: filePath });
  });
  protocolRegistered = true;
}

/** 生成 overlay 可用的雪碧图 URL */
export function seekPreviewSpriteUrl(cacheRoot: string, mediaKey: string): string {
  updateSeekPreviewProtocolCacheRoot(cacheRoot);
  return `evp-preview://sprite/${encodeURIComponent(mediaKey)}/sprite.jpg`;
}
