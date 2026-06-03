import { resolvePlayerLocale } from "electron-vlc-player";
import locales from "./example-ui-locales.json";
import type { LocaleView } from "./evp-api";
import type { ExampleLocale, ExampleUiLocalePack } from "./example-i18n-types";
import {
  LOCALE_MENU_LABELS,
  SUPPORTED_EXAMPLE_LOCALES,
} from "./example-i18n-types";

export type { ExampleLocale } from "./example-i18n-types";
export type { ExampleUiStrings } from "./evp-api";

const PACKS = locales as ExampleUiLocalePack;

export function getExampleUiStrings(locale: string) {
  const key = locale as ExampleLocale;
  const pack = PACKS[key];
  if (!pack) return PACKS.en;
  return { ...PACKS.en, ...pack };
}

export function buildLocaleView(locale?: string): LocaleView {
  const resolved = resolvePlayerLocale(locale);
  return {
    locale: resolved,
    ui: getExampleUiStrings(resolved),
    localeOptions: SUPPORTED_EXAMPLE_LOCALES.map((id) => ({
      id,
      label: LOCALE_MENU_LABELS[id],
    })),
  };
}
