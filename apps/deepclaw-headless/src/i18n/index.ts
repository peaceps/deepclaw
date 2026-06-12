import { loadConfig } from '@deepclaw/config';
import { mergeResources, init, DEFAULT_LANG } from '@deepclaw/i18n';
import { en } from './en';
import { zh } from './zh';

mergeResources({en, zh});
init(loadConfig<string>('ui.lang', DEFAULT_LANG));
