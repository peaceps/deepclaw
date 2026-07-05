import { LANG_LOCALE_MAP, SUPPORTED_LANGUAGES, SupportedLanguage } from "@deepclaw/i18n";

export function formatDate(lang: string, dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString(getLocale(
        SUPPORTED_LANGUAGES.includes(lang as SupportedLanguage) ? lang as SupportedLanguage : SUPPORTED_LANGUAGES[0]
    ), {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
}

function getLocale(lang: SupportedLanguage): string {
    return LANG_LOCALE_MAP[lang];
}
