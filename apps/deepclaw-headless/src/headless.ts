import { LoopInitializer } from '@deepclaw/agent';
import { validateEnvFile, validateAppConfig, cleanupOnShutdown } from '@deepclaw/utils';
import { i18nInstance } from '@deepclaw/i18n';
import { connectIM } from '@deepclaw/im';

const envConfig = validateEnvFile();
const appConfig = validateAppConfig(true);
if (envConfig.lacks.length > 0 || appConfig.lacks.length > 0) {
    console.error(i18nInstance.t('headless.invalidConfig'));
    process.exit(1);
}

const agent = new (LoopInitializer.getLoopClass())({
    onText: () => {},
    onEvent: async () => Promise.resolve(''),
});

const {disconnect} = connectIM(agent);

cleanupOnShutdown(disconnect);
