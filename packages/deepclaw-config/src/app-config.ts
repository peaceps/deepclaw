import { FileUtils } from '@deepclaw/utils';

const APP_CONFIG_FILE = '.deepclaw.config.json';

type AgentConfigSingleValue = string | number | boolean;
type AgentConfigValue = AgentConfigSingleValue | AgentConfigSingleValue[] | undefined;
type ConfigObject = {[key: string]: AgentConfigValue | ConfigObject | ConfigObject[]};

export type DeepclawConfig = {
    agents: {
        name: string;
        headlessEnabled: string;
        im?: {
            engine: 'dingtalk' | 'feishu';
            appId: string;
            secret: string;
        },
        mode: 'agent' | 'plan' | 'chat';
        standaloneTask: 'transient' | 'persistent' | 'ask';
        llm: {
            provider: string;
            baseUrl: string;
            apiKey: string;
            model: string;
            responseApi: boolean;
            workspace?: string;
        }
    }[],
    ui: {
        lang: string;
    }
};

export type MissingAppConfig = (string|{[key in keyof Partial<DeepclawConfig>]: {[key: number]: string[]}})[];

export const DEFAULT_LANG = 'en';

let deepclawConfig: DeepclawConfig = loadAppConfig();

function loadAppConfig(): DeepclawConfig {
    let appConfig: Partial<DeepclawConfig> = {};
    try {
        appConfig = JSON.parse(FileUtils.readFile(APP_CONFIG_FILE));
    } catch {
        // ignore malformed or missing config file
    }
    return Object.freeze(appConfig) as DeepclawConfig;
}

function mergeAbsence(target: ConfigObject, source: ConfigObject): ConfigObject {
    Object.keys(source).forEach(key => {
        if (Array.isArray(source[key])) {
            if (!target[key]) {
                target[key] = source[key];
            }
        }
        if (typeof source[key] === 'object') {
            if (typeof target[key] !== 'object') {
                target[key] = {};
            }
            mergeAbsence(target[key] as ConfigObject, source[key] as ConfigObject);
        } else {
            target[key] = target[key] ?? source[key];
        }
    });
    return target;
}

export function validateAppConfig(headless: boolean): {config: DeepclawConfig, lacks: MissingAppConfig} {
    const lacks: MissingAppConfig = [];
    const cloned: DeepclawConfig = mergeAbsence({}, deepclawConfig) as DeepclawConfig;
    if (!cloned.ui) {
        cloned.ui = {} as DeepclawConfig['ui'];
    }
    if (cloned.ui.lang && !['en', 'zh'].includes(cloned.ui.lang)) {
        cloned.ui.lang = 'undefined' as any;
    }
    if (!cloned.ui.lang) {
        lacks.push('ui.lang');
    }
    if (!cloned.agents?.length) {
        cloned.agents = [{
            name: 'main',
            standaloneTask: 'transient',
            llm: {}
        } as DeepclawConfig['agents'][0]];
        lacks.push({agents: {0: ['mode', 'headlessEnabled', 'llm.provider', 'llm.baseUrl', 'llm.apiKey', 'llm.model']}});
    } else {
        const agentsLacks: {[key: number]: string[]} = {};
        cloned.agents.forEach((agent, index) => {
            const agentLacks: string[] = [];
            if (agent.mode && !['agent', 'plan', 'chat'].includes(agent.mode)) {
                agent.mode = undefined as any;
            }
            if (!agent.mode) {
                agentLacks.push(`mode`);
            }
            if (agent.headlessEnabled && !['true', 'false'].includes(agent.headlessEnabled)) {
                agent.headlessEnabled = undefined as any;
            }
            if (!headless && !agent.headlessEnabled) {
                agentLacks.push(`headlessEnabled`);
            }
            if (headless) {
                agent.headlessEnabled = 'true';
            }
            if (agent.im && (
                !['dingtalk', 'feishu'].includes(agent.im.engine)
                || !agent.im.appId
                || !agent.im.secret
            )) {
                agent.im = undefined;
            }
            if (agent.headlessEnabled === 'true' && !agent.im) {
                agent.im = {} as DeepclawConfig['agents'][0]['im'];
                agentLacks.push(`im.engine`, `im.appId`, `im.secret`);
            }

            if (!agent.llm) {
                agent.llm = {responseApi: true} as DeepclawConfig['agents'][0]['llm'];
                agentLacks.push('llm.provider', 'llm.baseUrl', 'llm.apiKey', 'llm.model');
            } else {
                if (!['openai', 'anthropic'].includes(agent.llm.provider || '')) {
                    agentLacks.push('llm.provider');
                }
                if (!agent.llm.baseUrl) {
                    agentLacks.push('llm.baseUrl');
                }
                if (!agent.llm.apiKey) {
                    agentLacks.push('llm.apiKey');
                }
                if (!agent.llm.model) {
                    agentLacks.push('llm.model');
                }
            }
            if (agentLacks.length > 0) {
                agentsLacks[index] = agentLacks;
            }
        });
        if (Object.keys(agentsLacks).length > 0) {
            lacks.push({agents: agentsLacks});
        }
    }
    return {config: cloned, lacks};
}

export function writeAppConfig(config: DeepclawConfig) {
    FileUtils.writeFile(APP_CONFIG_FILE, JSON.stringify(config, null, 2));
    deepclawConfig = loadAppConfig();
}

export function loadConfig<T>(key: string, defaultValue?: T): T {
    const keyPath = key.split('.');
    let value: any = deepclawConfig;
    for (const key of keyPath) {
        value = value?.[key as keyof typeof value];
    }
    return (value ?? defaultValue) as T;
}

export function loadAgentConfig(name: string): DeepclawConfig['agents'][0] {
    const agents = loadConfig<DeepclawConfig['agents']>('agents');
    const agent = agents.find(a => a.name === name);
    if (!agent) {
        throw new Error('Agent doesn\'t exit!');
    }
    return agent;
}
