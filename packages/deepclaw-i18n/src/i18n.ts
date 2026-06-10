import i18n, { Module } from 'i18next';

const locales = {
    en: {translation: {}},
    zh: {translation: {}}
}

export function mergeResources(resources: Record<string, any>): void {
    Object.keys(resources).forEach((lang: string) => {
        Object.assign(locales[lang as keyof typeof locales].translation, resources[lang]);
    });
}

export function init(lng: string, defaultLng: string, middleware?: Module) {
    const mid = middleware ? i18n.use(middleware) : i18n;
    mid.init({
        debug: false,
        lng,
        fallbackLng: defaultLng,
        interpolation: {
            escapeValue: false, // not needed for react as it escapes by default
        },
        resources: locales
    });
}

export const i18nInstance = i18n;
