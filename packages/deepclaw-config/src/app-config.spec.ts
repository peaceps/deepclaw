import {describe, expect, test} from 'vitest';
import {
    loadConfig, validateAppConfig,
    type AgentConfig, type DeepclawConfig, type IMConfig, type LLMConfig,
    type MultimodalConfig, type UIConfig
} from './app-config';
import {type ImageModel} from './image-models';

function newAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
    return {
        id: 'a1',
        name: 'Ada',
        mode: 'agent',
        im: {enabled: false},
        llm: {baseURL: 'https://api.example.com', apiKey: 'key', model: 'model'},
        multimodal: {},
        ...overrides,
    };
}

function newConfig(overrides: Partial<DeepclawConfig> = {}): Partial<DeepclawConfig> {
    return {
        manager: {name: 'Deepclaw', title: 'CEO', avatar: '🐋'},
        agents: [newAgent()],
        ui: {lang: 'en'},
        advanced: {},
        ...overrides,
    };
}

function agentLacks(lacks: ReturnType<typeof validateAppConfig>['lacks'], index = 0): string[] {
    const entry = lacks.find(lack => typeof lack !== 'string') as
        {agents?: Record<number, string[]>} | undefined;
    return entry?.agents?.[index] ?? [];
}

describe('config-utils', () => {

    test('returns undefined for missing keys', () => {
        expect(loadConfig<string | undefined>('agent.not.exists')).toBeUndefined();
        expect(loadConfig<string | undefined>('ui.theme')).toBeUndefined();
    });
});

describe('validateAppConfig ui', () => {

    test('reports nothing for a complete config', () => {
        expect(validateAppConfig(newConfig()).lacks).toEqual([]);
    });

    test('reports a missing language', () => {
        expect(validateAppConfig(newConfig({ui: {} as UIConfig})).lacks).toContain('ui.lang');
    });

    test('clears an unsupported language and reports it as missing', () => {
        const {config, lacks} = validateAppConfig(newConfig({ui: {lang: 'fr' as UIConfig['lang']}}));
        expect(lacks).toContain('ui.lang');
        expect(config.ui.lang).toBeUndefined();
    });

    test('accepts every supported language', () => {
        expect(validateAppConfig(newConfig({ui: {lang: 'en'}})).lacks).toEqual([]);
        expect(validateAppConfig(newConfig({ui: {lang: 'zh'}})).lacks).toEqual([]);
    });

    test('throws when the config has not been migrated yet', () => {
        expect(() => validateAppConfig({})).toThrow();
    });
});

describe('validateAppConfig agents', () => {

    test('reports the whole agents list when it is empty', () => {
        expect(validateAppConfig(newConfig({agents: []})).lacks).toContain('agents');
    });

    test('reports the whole agents list when it is absent', () => {
        expect(validateAppConfig(newConfig({agents: undefined})).lacks).toContain('agents');
    });

    test('ignores fired agents', () => {
        const fired = newAgent({fired: true, name: '', llm: {} as LLMConfig});
        expect(validateAppConfig(newConfig({agents: [fired]})).lacks).toEqual([]);
    });

    test('reports a missing name', () => {
        const {lacks} = validateAppConfig(newConfig({agents: [newAgent({name: ''})]}));
        expect(agentLacks(lacks)).toEqual(['name']);
    });

    test('clears an invalid mode and reports it', () => {
        const invalid = newAgent({mode: 'wrong' as AgentConfig['mode']});
        const {config, lacks} = validateAppConfig(newConfig({agents: [invalid]}));
        expect(agentLacks(lacks)).toEqual(['mode']);
        expect(config.agents[0]!.mode).toBeUndefined();
    });

    test('indexes the lacks by agent position', () => {
        const agents = [newAgent(), newAgent({id: 'a2', name: ''})];
        const {lacks} = validateAppConfig(newConfig({agents}));
        expect(agentLacks(lacks, 0)).toEqual([]);
        expect(agentLacks(lacks, 1)).toEqual(['name']);
    });

    test('keeps the given config untouched', () => {
        const config = newConfig({ui: {lang: 'fr' as UIConfig['lang']}, agents: [newAgent({mode: 'bad' as AgentConfig['mode']})]});
        validateAppConfig(config);
        expect(config.ui!.lang).toBe('fr');
        expect(config.agents![0]!.mode).toBe('bad');
    });
});

describe('validateAppConfig im', () => {

    test('creates the missing im object and reports its switch', () => {
        const agent = newAgent({im: undefined as unknown as IMConfig});
        const {config, lacks} = validateAppConfig(newConfig({agents: [agent]}));
        expect(agentLacks(lacks)).toEqual(['im.enabled']);
        expect(config.agents[0]!.im).toEqual({enabled: false});
    });

    test('falls back to disabled when the switch is not a boolean', () => {
        const agent = newAgent({im: {enabled: 'yes' as unknown as boolean}});
        const {config, lacks} = validateAppConfig(newConfig({agents: [agent]}));
        expect(agentLacks(lacks)).toEqual(['im.enabled']);
        expect(config.agents[0]!.im.enabled).toBe(false);
    });

    test('skips the credentials while im is disabled', () => {
        const {lacks} = validateAppConfig(newConfig({agents: [newAgent({im: {enabled: false}})]}));
        expect(agentLacks(lacks)).toEqual([]);
    });

    test('reports every credential once im is enabled', () => {
        const {lacks} = validateAppConfig(newConfig({agents: [newAgent({im: {enabled: true}})]}));
        expect(agentLacks(lacks)).toEqual(['im.engine', 'im.appId', 'im.secret']);
    });

    test('clears an unsupported engine and reports it', () => {
        const agent = newAgent({im: {
            enabled: true, engine: 'wechat' as IMConfig['engine'], appId: 'id', secret: 'secret'
        }});
        const {config, lacks} = validateAppConfig(newConfig({agents: [agent]}));
        expect(agentLacks(lacks)).toEqual(['im.engine']);
        expect(config.agents[0]!.im.engine).toBeUndefined();
    });

    test('accepts the supported engines', () => {
        for (const engine of ['dingtalk', 'feishu'] as const) {
            const agent = newAgent({im: {enabled: true, engine, appId: 'id', secret: 'secret'}});
            expect(validateAppConfig(newConfig({agents: [agent]})).lacks).toEqual([]);
        }
    });
});

describe('validateAppConfig llm', () => {

    test('reports every field when the llm block is absent', () => {
        const agent = newAgent({llm: undefined as unknown as LLMConfig});
        const {config, lacks} = validateAppConfig(newConfig({agents: [agent]}));
        expect(agentLacks(lacks)).toEqual(['llm.baseURL', 'llm.apiKey', 'llm.model']);
        expect(config.agents[0]!.llm).toEqual({});
    });

    test('reports only the empty fields', () => {
        const agent = newAgent({llm: {baseURL: '', apiKey: 'key', model: ''}});
        const {lacks} = validateAppConfig(newConfig({agents: [agent]}));
        expect(agentLacks(lacks)).toEqual(['llm.baseURL', 'llm.model']);
    });
});

describe('validateAppConfig multimodal', () => {

    test('keeps a known image model and never demands one', () => {
        const multimodal = {imageModel: 'doubao-seedream-4-0-250828' as const, imageApiKey: 'key'};
        const {config, lacks} = validateAppConfig(newConfig({agents: [newAgent({multimodal})]}));
        expect(config.agents[0]!.multimodal).toEqual(multimodal);
        expect(agentLacks(lacks)).toEqual([]);
    });

    test('drops an image model nobody serves', () => {
        const multimodal = {imageModel: 'dall-e-1' as unknown as ImageModel};
        const {config} = validateAppConfig(newConfig({agents: [newAgent({multimodal})]}));
        expect(config.agents[0]!.multimodal.imageModel).toBeUndefined();
    });

    test('gives an agent that has never drawn a block of its own', () => {
        const agent = newAgent({multimodal: undefined as unknown as MultimodalConfig});
        const {config} = validateAppConfig(newConfig({agents: [agent]}));
        expect(config.agents[0]!.multimodal).toEqual({});
    });
});
