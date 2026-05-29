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
    onStreamText: () => {},
    onToolText: () => {},
    // TODO: How to handle interaction event in headless mode?
    onInteractionEvent: async () => Promise.reject('Not supported in headless mode.'),
});

const {disconnect} = connectIM(agent);

cleanupOnShutdown(disconnect);
