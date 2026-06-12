import { initReactI18next } from 'react-i18next';
import { mergeResources, init, DEFAULT_LANG } from '@deepclaw/i18n';
import { loadConfig } from '@deepclaw/config';
import { en } from './en';
import { zh } from './zh';

mergeResources({en, zh});

init(loadConfig<string>('ui.lang', DEFAULT_LANG), initReactI18next);
