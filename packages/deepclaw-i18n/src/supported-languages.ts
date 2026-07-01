export const SUPPORTED_LANGUAGES = ['en', 'zh'] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

export const FULL_NAME_MAP: Record<SupportedLanguage, string> = {
    en: 'English',
    zh: '简体中文'
};
