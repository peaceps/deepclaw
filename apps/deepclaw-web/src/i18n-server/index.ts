import { mergeResources, init } from '@deepclaw/i18n';
import { en } from './en';
import { zh } from './zh';
import { loadLang } from '@deepclaw/config';

mergeResources({en, zh});

init(loadLang());
