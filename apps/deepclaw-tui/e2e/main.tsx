import {render} from 'ink';
import '../src/i18n/index.js';
import {App, type AppConfig } from '../src/components/app.js';
import {TestLlmAgent} from '@deepclaw/agentmock';

const appWrapper: AppConfig = {
    getAgentClass: () => TestLlmAgent
};

const {waitUntilExit} = render(<App app={appWrapper}/>);
await waitUntilExit();
console.log(`\n  Bye~`);
