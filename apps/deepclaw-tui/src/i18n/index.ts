import { initReactI18next } from 'react-i18next';
import { mergeResources, init } from '@deepclaw/i18n';
import { loadLang } from '@deepclaw/config';
import { en } from './en';
import { zh } from './zh';

mergeResources({en, zh});

init(loadLang(), initReactI18next);
