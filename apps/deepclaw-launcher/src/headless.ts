import { LoopInitializer } from '@deepclaw/agent';
import { validateEnvFile, validateAppConfig } from '@deepclaw/utils';

import { connectIM } from '@deepclaw/im';

let isShuttingDown = false;

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

const {disconnect} = connectIM(agent);

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', () => {
  gracefulShutdown('uncaughtException');
});

async function gracefulShutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.info('exit:', signal);
    try {
        disconnect();
    } catch (err) {
        console.error('error:', err);
    } finally {
        process.exit(0);
    }
}
