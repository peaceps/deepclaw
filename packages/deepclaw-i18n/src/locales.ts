import { SUPPORTED_LANGUAGES, SupportedLanguage } from "./supported-languages";

export const LANG_BCP47_LOCALE_MAP: Record<SupportedLanguage, string> = {
    zh: 'zh-CN',
    en: 'en-US'
};

export const ISO639_1_LOCALE_MAP: Record<SupportedLanguage, string> = { zh: 'zh_CN', en: 'en' };

const DEFAULT_LOCALE = Intl.DateTimeFormat().resolvedOptions().locale;

export const DEFAULT_LANG: SupportedLanguage = Object.keys(LANG_BCP47_LOCALE_MAP)
    .find(lang => DEFAULT_LOCALE.startsWith(lang)) as SupportedLanguage || SUPPORTED_LANGUAGES[0];
