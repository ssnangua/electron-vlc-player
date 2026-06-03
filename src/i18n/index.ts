import { app } from 'electron';

import { de } from './locales/de';
import { en } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { ptBR } from './locales/pt-BR';
import { ru } from './locales/ru';
import { zhCN } from './locales/zh-CN';
import { zhTW } from './locales/zh-TW';
import type { VlcPlayerLocale, VlcPlayerStrings } from './types';

export type { VlcPlayerLocale, VlcPlayerStrings } from './types';

const LOCALE_PACKS: Record<VlcPlayerLocale, VlcPlayerStrings> = {
  en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  ja,
  ko,
  de,
  fr,
  es,
  'pt-BR': ptBR,
  ru,
};

/** 内置语言包标识列表 */
export const SUPPORTED_PLAYER_LOCALES = Object.keys(LOCALE_PACKS) as VlcPlayerLocale[];

const LOCALE_ALIASES: Record<string, VlcPlayerLocale> = {
  zh: 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-hant': 'zh-TW',
  'zh-hk': 'zh-TW',
  'zh-mo': 'zh-TW',
  pt: 'pt-BR',
};

function normalizeLocaleTag(raw: string): string {
  return raw.trim().replace(/_/g, '-');
}

/** 读取操作系统 / Electron 当前语言 */
export function detectSystemLocale(): string {
  try {
    const loc = app.getLocale?.();
    if (loc?.trim()) return normalizeLocaleTag(loc);
  } catch {
    // ignore
  }
  const env = process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL || '';
  const part = env.split('.')[0]?.split(':')[0]?.trim();
  return part ? normalizeLocaleTag(part) : 'en';
}

/**
 * 解析为内置语言包 id。未传 `locale` 时使用系统语言；无匹配时回退 `en`。
 */
export function resolvePlayerLocale(locale?: string): VlcPlayerLocale {
  const raw = normalizeLocaleTag(locale?.trim() || detectSystemLocale() || 'en');
  const lower = raw.toLowerCase();

  for (const key of SUPPORTED_PLAYER_LOCALES) {
    if (key.toLowerCase() === lower) return key;
  }

  const alias = LOCALE_ALIASES[lower];
  if (alias) return alias;

  const lang = lower.split('-')[0];
  const langAlias = LOCALE_ALIASES[lang];
  if (langAlias) return langAlias;

  for (const key of SUPPORTED_PLAYER_LOCALES) {
    if (key.toLowerCase().startsWith(`${lang}-`) || key.toLowerCase() === lang) {
      return key;
    }
  }

  return 'en';
}

export function getPlayerStrings(locale?: string): VlcPlayerStrings {
  return LOCALE_PACKS[resolvePlayerLocale(locale)];
}

export function formatTrackFallback(strings: VlcPlayerStrings, id: number): string {
  return strings.trackFallback.replace('{id}', String(id));
}
