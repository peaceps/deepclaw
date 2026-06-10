import { initReactI18next } from 'react-i18next';
import { mergeResources, init } from '@deepclaw/i18n';
import { en } from './en';
import { zh } from './zh';

mergeResources({en, zh});

export function initI18n(lang: string, defaultLang: string, ...resources: Record<string, any>[]) {
    resources.forEach(resource => mergeResources(resource));
    init(lang, defaultLang, initReactI18next);
}
