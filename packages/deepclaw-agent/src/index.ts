import './i18n/index';
import { FileUtils } from '@deepclaw/utils';
import { DEEPCLAW_MD, SKILL_DIR } from './agent/paths';
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
FileUtils.copyResource(__dirname, DEEPCLAW_MD);
FileUtils.copyResource(__dirname, SKILL_DIR);

export * from './agent/loop-initializer';
export * from './agent/loop/services/project-manager';
