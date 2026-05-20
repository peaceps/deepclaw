import {render} from 'ink';
import './i18n/index.js';
import {LoopInitializer} from '@deepclaw/agent';
import {App, type AppConfig } from './components/app.js';
import { i18nInstance } from '@deepclaw/i18n';

const appWrapper: AppConfig = {
    getAgentClass: () => LoopInitializer.getLoopClass()
};

const {waitUntilExit} = render(<App app={appWrapper}/>);
await waitUntilExit();
console.log(`\n  ${i18nInstance.t('bye')}`);
