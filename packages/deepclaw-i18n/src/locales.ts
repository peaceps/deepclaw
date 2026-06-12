export const LANG_LOCALE_MAP: Record<string, string> = {
    zh: 'zh-CN',
    en: 'en-US'
};

const DEFAULT_LOCALE = Intl.DateTimeFormat().resolvedOptions().locale;

export const DEFAULT_LANG = Object.keys(LANG_LOCALE_MAP)
    .find(lang => DEFAULT_LOCALE.startsWith(lang)) || 'en';
