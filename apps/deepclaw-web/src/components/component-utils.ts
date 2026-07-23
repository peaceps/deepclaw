import cronstrue from "cronstrue";
import "cronstrue/locales/zh_CN";
import {
    LANG_BCP47_LOCALE_MAP, ISO639_1_LOCALE_MAP, SUPPORTED_LANGUAGES, SupportedLanguage
} from "@deepclaw/i18n";

export function formatDate(lang: string, dateSeed?: string | number): string {
    if (!dateSeed) {
        return '-';
    }
    const date = new Date(dateSeed);
    return date.toLocaleDateString(getLocale(
        SUPPORTED_LANGUAGES.includes(lang as SupportedLanguage) ? lang as SupportedLanguage : SUPPORTED_LANGUAGES[0]
    ), {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
}

export function translateCron(lang: SupportedLanguage, cron: string): string {
    return cronstrue.toString(cron, { locale: ISO639_1_LOCALE_MAP[lang] });
}

function getLocale(lang: SupportedLanguage): string {
    return LANG_BCP47_LOCALE_MAP[lang];
}
