import cronstrue from "cronstrue";
import "cronstrue/locales/zh_CN";
import {
    LANG_BCP47_LOCALE_MAP, ISO639_1_LOCALE_MAP, SUPPORTED_LANGUAGES, SupportedLanguage
} from "@deepclaw/i18n";
import { UpdateContent, StringKeys } from "@deepclaw/utils";

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

export function handleUpdateRecordContent<T, K extends StringKeys<T> = Extract<'id', StringKeys<T>>>(
    prev: Record<string, T>, content: UpdateContent<T, NoInfer<K>>, deleted: boolean = false, key: K = 'id' as K
): Record<string, T> {
    const id = content[key] as string;
    if (deleted) {
        const rest = { ...prev };
        delete rest[id];
        return rest;
    }
    const existing = prev[id];
    return {
        ...prev,
        [id]: existing ? mergeContent<T>(existing, content, key) : (content as T),
    };
}

export function handleUpdatedArrayContent<T, K extends StringKeys<T> = Extract<'id', StringKeys<T>>>(
    prev: T[], content: UpdateContent<T, NoInfer<K>>, deleted: boolean = false, key: K = 'id' as K
): T[] {
    if (deleted) {
        return prev.filter(t => t[key] !== content[key]);
    }
    const exists = prev.some(t => t[key] === content[key]);
    if (exists) {
        return prev.map(t => t[key] === content[key] ? mergeContent<T>(t, content, key) : t);
    } else {
        return [...prev, content as T];
    }
}

function mergeContent<T>(
    t: T, content: Partial<{ [P in keyof T]: T[P] | null }>, key: keyof T
): T {
    const merged: Record<string, unknown> = { ...(t as Record<string, unknown>) };
    for (const [k, v] of Object.entries(content)) {
        if (k === key) continue;
        if (v === null) delete merged[k];
        else merged[k] = v;
    }
    return merged as T;
}
