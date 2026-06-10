import { mergeResources } from '@deepclaw/i18n';
import { en } from './en';
import { zh } from './zh';

const CONFIG_I18N = {en, zh};

mergeResources(CONFIG_I18N);
