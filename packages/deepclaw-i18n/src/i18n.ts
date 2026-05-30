import i18n, { Module } from 'i18next';
import {DEFAULT_LANG, loadConfig} from '@deepclaw/config';

const locales = {
    en: {translation: {}},
    zh: {translation: {}}
}

let lang = loadConfig<string>('ui.lang');
if (!(lang in locales)) {
  lang = DEFAULT_LANG;
}

export function mergeResources(resources: Record<string, any>): void {
    Object.keys(resources).forEach((lang: string) => {
        Object.assign(locales[lang as keyof typeof locales].translation, resources[lang]);
    });
}

export function init(middleware?: Module) {
    const mid = middleware ? i18n.use(middleware) : i18n;
    mid.init({
        debug: false,
        lng: lang,
        fallbackLng: DEFAULT_LANG,
        interpolation: {
            escapeValue: false, // not needed for react as it escapes by default
        },
        resources: locales
    });
}

export const i18nInstance = i18n;