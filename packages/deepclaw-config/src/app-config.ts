import crypto from 'crypto';
import { DEFAULT_LANG, SUPPORTED_LANGUAGES, SupportedLanguage } from '@deepclaw/i18n';
import { FileUtils, globalize } from '@deepclaw/node-utils';

const APP_CONFIG_FILE = '.deepclaw.config.json';

export const MAX_AGENT_COUNT = 30;

type AgentConfigSingleValue = string | number | boolean;
type AgentConfigValue = AgentConfigSingleValue | AgentConfigSingleValue[] | undefined;
type ConfigObject = {[key: string]: AgentConfigValue | ConfigObject | ConfigObject[]};

export type DeepclawConfig = {
    manager: {
        name: string;
        title: string;
        avatar: string;
    },
    agents: {
        id: string;
        name: string;
        fired?: boolean;
        im?: {
            engine: 'dingtalk' | 'feishu';
            appId: string;
            secret: string;
        },
        mode: 'agent' | 'chat';
        llm: {
            baseURL: string;
            apiKey: string;
            model: string;
        }
    }[],
    ui: {
        lang: SupportedLanguage;
    }
};
export type ManagerConfig = DeepclawConfig['manager'];
export type UIConfig = DeepclawConfig['ui'];
export type AgentsConfig = DeepclawConfig['agents'];
export type AgentConfig = AgentsConfig[number];
export type AgentMode = AgentConfig['mode'];
export type IMConfig = NonNullable<AgentConfig['im']>;
export type LLMConfig = AgentConfig['llm'];

export type MissingAppConfig = (string|{[key in keyof Partial<DeepclawConfig>]: {[key: number]: string[]}})[];

const globalDeepclawConfig: {config: DeepclawConfig} =
    globalize('globalDeepclawConfig', {config: loadAppConfig()});

function loadAppConfig(): DeepclawConfig {
    let appConfig: Partial<DeepclawConfig> = {};
    try {
        appConfig = JSON.parse(FileUtils.readFile(APP_CONFIG_FILE));
    } catch {
        // ignore malformed or missing config file
    }
    autoMigrate(appConfig);
    return Object.freeze(appConfig) as DeepclawConfig;
}

function autoMigrate(appConfig: Partial<DeepclawConfig>): void {
    if (!appConfig.agents) {
        appConfig.agents = [];
    }
    if (!appConfig.ui) {
        appConfig.ui = {} as UIConfig;
    }
    if (!appConfig.manager) {
        appConfig.manager = {} as ManagerConfig;
    }
    if (!appConfig.manager.name || typeof appConfig.manager.name !== 'string') {
        appConfig.manager.name = 'Deepclaw';
    }
    if (!appConfig.manager.title || typeof appConfig.manager.title !== 'string' ) {
        appConfig.manager.title = 'CEO';
    }
    if (!appConfig.manager.avatar || typeof appConfig.manager.avatar !== 'string') {
        appConfig.manager.avatar = '🐋';
    }
    for (const agent of appConfig.agents ?? []) {
        if (!agent.id || typeof agent.id !== 'string') {
            agent.id = crypto.randomUUID();
        }
    }
    const activeAgents = appConfig.agents.filter(agent => !agent.fired);
    if (activeAgents.length > MAX_AGENT_COUNT) {
        const active = activeAgents.slice(0, MAX_AGENT_COUNT);
        const fired = appConfig.agents.filter(agent => !!agent.fired);
        appConfig.agents = active.concat(fired);
    }
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

export function validateCurrentAppConfig(headless: boolean): {config: DeepclawConfig, lacks: MissingAppConfig} {
    return validateAppConfig(headless, globalDeepclawConfig.config);
}

export function validateAppConfig(headless: boolean, configToValidate: Partial<DeepclawConfig>): {
    config: DeepclawConfig, lacks: MissingAppConfig
} {
    const lacks: MissingAppConfig = [];
    const cloned: DeepclawConfig = mergeAbsence({}, configToValidate) as DeepclawConfig;
    if (cloned.ui.lang && !SUPPORTED_LANGUAGES.includes(cloned.ui.lang)) {
        cloned.ui.lang = undefined as any;
    }
    if (!cloned.ui.lang) {
        lacks.push('ui.lang');
    }
    if (!cloned.agents?.length) {
        lacks.push('agents');
    } else {
        const agentsLacks: {[key: number]: string[]} = {};
        cloned.agents.forEach((agent, index) => {
            if (agent.fired) {
                return;
            }
            const agentLacks: string[] = [];
            if (!agent.name) {
                agentLacks.push(`name`);
            }
            if (agent.mode && !['agent', 'chat'].includes(agent.mode)) {
                agent.mode = undefined as any;
            }
            if (!agent.mode) {
                agentLacks.push(`mode`);
            }
            if (!agent.im) {
                if (headless) {
                    agent.im = {} as IMConfig;
                    agentLacks.push(`im.engine`, `im.appId`, `im.secret`);
                }
            } else {
                if (!['dingtalk', 'feishu'].includes(agent.im.engine)) {
                    agentLacks.push('im.engine');
                }
                if (!agent.im.appId) {
                    agentLacks.push('im.appId');
                }
                if (!agent.im.secret) {
                    agentLacks.push('im.secret');
                }
            }

            if (!agent.llm) {
                agent.llm = {} as LLMConfig;
                agentLacks.push('llm.baseURL', 'llm.apiKey', 'llm.model');
            } else {
                if (!agent.llm.baseURL) {
                    agentLacks.push('llm.baseURL');
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
    autoMigrate(config);
    FileUtils.writeFile(APP_CONFIG_FILE, JSON.stringify(config, null, 2));
    globalDeepclawConfig.config = loadAppConfig();
}

export function loadConfig<T>(key?: string, defaultValue?: T): T {
    if (!key) return globalDeepclawConfig.config as T;
    const keyPath = key.split('.');
    let value: any = globalDeepclawConfig.config;
    for (const key of keyPath) {
        value = value?.[key as keyof typeof value];
    }
    return (value ?? defaultValue) as T;
}

export function loadAgentConfig(agentId: string): AgentConfig {
    const agents = loadConfig<AgentsConfig>('agents');
    const agent = agents.find(a => a.id === agentId);
    if (!agent) {
        throw new Error('Agent doesn\'t exit!');
    }
    return agent;
}

export function loadLang(): SupportedLanguage {
    return loadConfig<SupportedLanguage>('ui.lang', DEFAULT_LANG);
}
