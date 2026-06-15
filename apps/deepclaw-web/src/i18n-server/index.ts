import { mergeResources, init, DEFAULT_LANG } from '@deepclaw/i18n';
import { en } from './en';
import { zh } from './zh';
import { loadConfig } from '@deepclaw/config';

mergeResources({en, zh});

init(loadConfig<string>('ui.lang', DEFAULT_LANG));
