import { SUPPORTED_LANGUAGES, SupportedLanguage } from "./supported-languages";

export const LANG_LOCALE_MAP: Record<SupportedLanguage, string> = {
    zh: 'zh-CN',
    en: 'en-US'
};

const DEFAULT_LOCALE = Intl.DateTimeFormat().resolvedOptions().locale;

export const DEFAULT_LANG: SupportedLanguage = Object.keys(LANG_LOCALE_MAP)
    .find(lang => DEFAULT_LOCALE.startsWith(lang)) as SupportedLanguage || SUPPORTED_LANGUAGES[0];
