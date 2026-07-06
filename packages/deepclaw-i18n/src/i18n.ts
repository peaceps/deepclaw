import i18n, { Module } from 'i18next';
import { DEFAULT_LANG } from './locales';
import { SupportedLanguage } from './supported-languages';
import { globalize } from '@deepclaw/utils';

const locales: Record<SupportedLanguage, {translation: Record<string, string>}> = {
    en: {translation: {}},
    zh: {translation: {}}
}

export function mergeResourcesFn(resources: Record<string, any>): void {
    Object.keys(resources).forEach((lang: string) => {
        Object.assign(locales[lang as keyof typeof locales].translation, resources[lang]);
        if (i18n.isInitialized) {
            i18n.addResourceBundle(lang, 'translation', resources[lang], true, true);
        }
    });
}

export function initFn(lng: string, middleware?: Module) {
    if (i18n.isInitialized) {
        if (middleware && typeof (middleware as { init?: unknown }).init === 'function') {
            (middleware as unknown as { init: (instance: typeof i18n) => void }).init(i18n);
        }
        if (lng && i18n.language !== lng) {
            i18n.changeLanguage(lng);
        }
        return;
    }
    const mid = middleware ? i18n.use(middleware) : i18n;
    mid.init({
        debug: false,
        lng,
        fallbackLng: DEFAULT_LANG,
        interpolation: {
            escapeValue: false, // not needed for react as it escapes by default
        },
        resources: locales
    });
}

export function parseArrayI18n(key: string): string[] {
    const val = i18n.t(key);
    return typeof val === 'string' ? val.split(',') : [];
}

export const i18nInstance = globalize('i18nInstance', i18n);
export const mergeResources = globalize('mergeResources', mergeResourcesFn);
export const init = globalize('init', initFn);
