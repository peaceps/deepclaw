import { initReactI18next } from 'react-i18next';
import { mergeResources, init } from '@deepclaw/i18n';
import { en } from './en';
import { zh } from './zh';

mergeResources({en, zh});

init(initReactI18next);
