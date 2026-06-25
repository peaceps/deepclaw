import { LANG_LOCALE_MAP } from "@deepclaw/i18n";

export function formatDate(lang: string, dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString(getLocale(lang), {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
}

function getLocale(lang: string): string {
    return LANG_LOCALE_MAP[lang];
}
