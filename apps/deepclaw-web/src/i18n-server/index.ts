import { mergeResources, init } from '@deepclaw/i18n';
import { en } from '../i18n/en';
import { zh } from '../i18n/zh';
import { loadLang } from '@deepclaw/config';

mergeResources({en, zh});
init(loadLang());
