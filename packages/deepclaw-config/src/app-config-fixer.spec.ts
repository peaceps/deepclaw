import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentInteractionEventPayload} from '@deepclaw/core';
import {APP_CONFIG_EVENTS} from './app-config-events';
import {validateAndFixCurrentConfig} from './app-config-fixer';
import {type AgentConfig, type DeepclawConfig, type MissingAppConfig} from './app-config';

const mocks = vi.hoisted(() => ({
    validateCurrentAppConfig: vi.fn(),
    writeAppConfig: vi.fn(),
}));

vi.mock('./app-config', () => mocks);

function newConfig(agents: Partial<AgentConfig>[] = []): DeepclawConfig {
    return {
        manager: {name: 'Deepclaw', title: 'CEO', avatar: '🐋'},
        agents: agents as AgentConfig[],
        ui: {lang: 'en'},
        advanced: {},
    };
}

function scriptedHandler(answers: string[]) {
    let index = 0;
    const asked: AgentInteractionEventPayload[] = [];
    const handler = async (event: AgentInteractionEventPayload) => {
        asked.push(event);
        return answers[index++] ?? '';
    };
    return {handler, asked};
}

function pending(config: DeepclawConfig, lacks: MissingAppConfig) {
    mocks.validateCurrentAppConfig.mockReturnValue({config, lacks});
}

const AGENT_BOOTSTRAP_ANSWERS = ['hint', 'index', 'Ada', 'agent', 'https://api', 'key', 'model'];

describe('validateAndFixCurrentConfig', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('asks nothing and writes nothing when the config is complete', async () => {
        pending(newConfig(), []);
        const {handler, asked} = scriptedHandler([]);
        await validateAndFixCurrentConfig(handler);
        expect(asked).toEqual([]);
        expect(mocks.writeAppConfig).not.toHaveBeenCalled();
    });

    test('shows the hint before asking anything else', async () => {
        pending(newConfig([]), ['ui.lang']);
        const {handler, asked} = scriptedHandler(['hint', 'zh']);
        await validateAndFixCurrentConfig(handler);
        expect(asked).toEqual([APP_CONFIG_EVENTS['hint'], APP_CONFIG_EVENTS['ui.lang']]);
    });

    test('stores the answer of a top level lack and persists the config', async () => {
        const config = newConfig([]);
        pending(config, ['ui.lang']);
        const {handler} = scriptedHandler(['hint', 'zh']);
        await validateAndFixCurrentConfig(handler);
        expect(config.ui.lang).toBe('zh');
        expect(mocks.writeAppConfig).toHaveBeenCalledExactlyOnceWith(config);
    });

    test('bootstraps a placeholder agent when the whole list is missing', async () => {
        const config = newConfig([]);
        pending(config, ['agents']);
        const {handler, asked} = scriptedHandler([...AGENT_BOOTSTRAP_ANSWERS, 'no']);
        await validateAndFixCurrentConfig(handler);
        expect(asked).toEqual([
            APP_CONFIG_EVENTS['hint'],
            {...APP_CONFIG_EVENTS['agents.index'], i18nParam: {name: '1'}},
            APP_CONFIG_EVENTS['agents.name'],
            APP_CONFIG_EVENTS['agents.mode'],
            APP_CONFIG_EVENTS['agents.llm.baseURL'],
            APP_CONFIG_EVENTS['agents.llm.apiKey'],
            APP_CONFIG_EVENTS['agents.llm.model'],
            APP_CONFIG_EVENTS['agents.im.enabled'],
        ]);
        expect(config.agents).toEqual([{
            name: 'Ada',
            mode: 'agent',
            im: {enabled: false},
            llm: {baseURL: 'https://api', apiKey: 'key', model: 'model'},
        }]);
    });

    test('asks for the im credentials once the user enables im', async () => {
        const config = newConfig([]);
        pending(config, ['agents']);
        const {handler, asked} = scriptedHandler([
            ...AGENT_BOOTSTRAP_ANSWERS, 'yes', 'dingtalk', 'app-id', 'app-secret'
        ]);
        await validateAndFixCurrentConfig(handler);
        expect(asked.slice(-3)).toEqual([
            APP_CONFIG_EVENTS['agents.im.engine'],
            APP_CONFIG_EVENTS['agents.im.appId'],
            APP_CONFIG_EVENTS['agents.im.secret'],
        ]);
        expect(config.agents[0]!.im).toEqual({
            enabled: true, engine: 'dingtalk', appId: 'app-id', secret: 'app-secret'
        });
    });

    test('accepts the im switch case insensitively', async () => {
        const config = newConfig([]);
        pending(config, ['agents']);
        const {handler} = scriptedHandler([...AGENT_BOOTSTRAP_ANSWERS, 'YES', 'feishu', 'id', 'secret']);
        await validateAndFixCurrentConfig(handler);
        expect(config.agents[0]!.im.enabled).toBe(true);
    });

    test('treats any other answer as a disabled im', async () => {
        const config = newConfig([]);
        pending(config, ['agents']);
        const {handler, asked} = scriptedHandler([...AGENT_BOOTSTRAP_ANSWERS, 'later']);
        await validateAndFixCurrentConfig(handler);
        expect(config.agents[0]!.im).toEqual({enabled: false});
        expect(asked).toHaveLength(AGENT_BOOTSTRAP_ANSWERS.length + 1);
    });

    test('labels the agent prompt with its name when it already has one', async () => {
        const config = newConfig([{name: 'Bob', im: {enabled: false}, llm: {} as AgentConfig['llm']}]);
        pending(config, [{agents: {0: ['mode']}}]);
        const {handler, asked} = scriptedHandler(['hint', 'index', 'chat']);
        await validateAndFixCurrentConfig(handler);
        expect(asked[1]).toEqual({...APP_CONFIG_EVENTS['agents.index'], i18nParam: {name: 'Bob'}});
        expect(config.agents[0]!.mode).toBe('chat');
    });

    test('fixes several agents in one pass', async () => {
        const agents = [
            {name: 'Ada', im: {enabled: false}, llm: {} as AgentConfig['llm']},
            {name: 'Bob', im: {enabled: false}, llm: {} as AgentConfig['llm']},
        ];
        const config = newConfig(agents);
        pending(config, [{agents: {0: ['mode'], 1: ['name']}}]);
        const {handler} = scriptedHandler(['hint', 'index', 'agent', 'index', 'Bobby']);
        await validateAndFixCurrentConfig(handler);
        expect(config.agents[0]!.mode).toBe('agent');
        expect(config.agents[1]!.name).toBe('Bobby');
        expect(mocks.writeAppConfig).toHaveBeenCalledOnce();
    });
});
