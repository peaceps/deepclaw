import { FileUtils } from '@deepclaw/utils';
import { DEEPCLAW_MD, SKILL_DIR } from './agent/paths';
import { fileURLToPath } from 'url'
import { dirname } from 'path'

export function ensureBaseFiles() {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    FileUtils.copyResource(__dirname, DEEPCLAW_MD);
    FileUtils.copyResource(__dirname, SKILL_DIR);
}
