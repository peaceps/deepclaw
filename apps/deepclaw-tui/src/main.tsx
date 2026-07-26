import {render} from 'ink';
import './i18n/index';
import {App, type AppConfig } from './components/app';
import { i18nInstance } from '@deepclaw/i18n';
import { LoopGateway } from '@deepclaw/loop-gateway';

const appWrapper: AppConfig = {
};

LoopGateway.initGateway();
const {waitUntilExit} = render(<App app={appWrapper}/>);
await waitUntilExit();
console.log(`\n  ${i18nInstance.t('common.exit')}`);
