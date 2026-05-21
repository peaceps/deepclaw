import { LoopInitializer } from '@deepclaw/agent';
import { validateEnvFile, validateAppConfig } from '@deepclaw/utils';

import { connectIM } from '@deepclaw/im';

const envConfig = validateEnvFile();
const appConfig = validateAppConfig(true);
if (envConfig.lacks.length > 0 || appConfig.lacks.length > 0) {
    console.error('Invalid config, please config with tui first.');
    process.exit(1);
}

const agent = new (LoopInitializer.getLoopClass())({
    onText: () => {},
    onEvent: async () => Promise.resolve(''),
});

connectIM(agent);
