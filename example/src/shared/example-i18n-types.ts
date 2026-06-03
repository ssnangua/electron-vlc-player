import type { ExampleUiStrings } from "./evp-api";

/** Example UI locale ids — aligned with electron-vlc-player VlcPlayerLocale */
export type ExampleLocale =
  | "en"
  | "zh-CN"
  | "zh-TW"
  | "ja"
  | "ko"
  | "de"
  | "fr"
  | "es"
  | "pt-BR"
  | "ru";

export const SUPPORTED_EXAMPLE_LOCALES: ExampleLocale[] = [
  "en",
  "zh-CN",
  "zh-TW",
  "ja",
  "ko",
  "de",
  "fr",
  "es",
  "pt-BR",
  "ru",
];

export const LOCALE_MENU_LABELS: Record<ExampleLocale, string> = {
  en: "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
  ko: "한국어",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  "pt-BR": "Português (Brasil)",
  ru: "Русский",
};

export type ExampleUiLocalePack = Record<ExampleLocale, ExampleUiStrings>;
