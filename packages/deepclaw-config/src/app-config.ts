import crypto from 'crypto';
import { FileUtils } from '@deepclaw/node-utils';

const APP_CONFIG_FILE = '.deepclaw.config.json';

type AgentConfigSingleValue = string | number | boolean;
type AgentConfigValue = AgentConfigSingleValue | AgentConfigSingleValue[] | undefined;
type ConfigObject = {[key: string]: AgentConfigValue | ConfigObject | ConfigObject[]};

export type DeepclawConfig = {
    manager: {
        name: string;
        title: string;
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
        mode: 'agent' | 'plan' | 'chat';
        llm: {
            baseURL: string;
            apiKey: string;
            model: string;
        }
    }[],
    ui: {
        lang: string;
    }
};

export type MissingAppConfig = (string|{[key in keyof Partial<DeepclawConfig>]: {[key: number]: string[]}})[];

let currentDeepclawConfig: DeepclawConfig = loadAppConfig();

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
        appConfig.ui = {} as DeepclawConfig['ui'];
    }
    if (!appConfig.manager) {
        appConfig.manager = {} as DeepclawConfig['manager'];
    }
    if (!appConfig.manager.name || typeof appConfig.manager.name !== 'string') {
        appConfig.manager.name = 'Deepclaw';
    }
    if (!appConfig.manager.title || typeof appConfig.manager.title !== 'string' ) {
        appConfig.manager.title = 'CEO';
    }
    for (const agent of appConfig.agents ?? []) {
        if (!agent.id || typeof agent.id !== 'string') {
            agent.id = crypto.randomUUID();
        }
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

export function validateCurrentAppConfig(headless: boolean, reload = false): {config: DeepclawConfig, lacks: MissingAppConfig} {
    return validateAppConfig(headless, reload ? loadAppConfig() : currentDeepclawConfig);
}

export function validateAppConfig(headless: boolean, configToValidate: Partial<DeepclawConfig>): {config: DeepclawConfig, lacks: MissingAppConfig} {
    const lacks: MissingAppConfig = [];
    const cloned: DeepclawConfig = mergeAbsence({}, configToValidate) as DeepclawConfig;
    if (cloned.ui.lang && !['en', 'zh'].includes(cloned.ui.lang)) {
        cloned.ui.lang = 'undefined' as any;
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
            if (agent.mode && !['agent', 'plan', 'chat'].includes(agent.mode)) {
                agent.mode = undefined as any;
            }
            if (!agent.mode) {
                agentLacks.push(`mode`);
            }
            if (!agent.im) {
                if (headless) {
                    agent.im = {} as DeepclawConfig['agents'][0]['im'];
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
                agent.llm = {} as DeepclawConfig['agents'][0]['llm'];
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
    currentDeepclawConfig = loadAppConfig();
}

export function loadConfig<T>(key?: string, defaultValue?: T): T {
    if (!key) return currentDeepclawConfig as T;
    const keyPath = key.split('.');
    let value: any = currentDeepclawConfig;
    for (const key of keyPath) {
        value = value?.[key as keyof typeof value];
    }
    return (value ?? defaultValue) as T;
}

export function loadAgentConfig(agentId: string): DeepclawConfig['agents'][0] {
    const agents = loadConfig<DeepclawConfig['agents']>('agents');
    const agent = agents.find(a => a.id === agentId);
    if (!agent) {
        throw new Error('Agent doesn\'t exit!');
    }
    return agent;
}
