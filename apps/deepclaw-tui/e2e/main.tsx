import {render} from 'ink';
import '../src/i18n/index';
import {App, type AppConfig } from '../src/components/app';
import {TestLlmAgent} from '@deepclaw/agentmock';
import {i18nInstance} from '@deepclaw/i18n';

const appWrapper: AppConfig = {
    getAgentClass: () => TestLlmAgent
};

const {waitUntilExit} = render(<App app={appWrapper}/>);
await waitUntilExit();
console.log(`\n  ${i18nInstance.t('common.exit')}`);
