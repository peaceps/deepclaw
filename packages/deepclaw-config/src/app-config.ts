import crypto from 'crypto';
import { DEFAULT_LANG, SUPPORTED_LANGUAGES, SupportedLanguage } from '@deepclaw/i18n';
import { clone, FileUtils, globalize } from '@deepclaw/node-utils';
import { IMAGE_MODELS, type ImageModel } from './image-models';

const APP_CONFIG_FILE = '.deepclaw.config.json';

export const MAX_AGENT_COUNT = 30;

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
        im: {
            enabled: boolean;
            engine?: 'dingtalk' | 'feishu';
            appId?: string;
            secret?: string;
        },
        mode: 'agent' | 'chat';
        llm: {
            baseURL: string;
            apiKey: string;
            model: string;
        },
        /** What the agent works in besides words. Drawing, for now. */
        multimodal: {
            imageModel?: ImageModel;
            /** Key for image generation. Falls back to the variable of the picked vendor. */
            imageApiKey?: string;
        }
    }[],
    ui: {
        lang: SupportedLanguage;
    },
    advanced: {
        mcpServer?: string;
    }
};
export type ManagerConfig = DeepclawConfig['manager'];
export type UIConfig = DeepclawConfig['ui'];
export type AgentsConfig = DeepclawConfig['agents'];
export type AgentConfig = AgentsConfig[number];
export type AgentMode = AgentConfig['mode'];
export type IMConfig = NonNullable<AgentConfig['im']>;
export type LLMConfig = AgentConfig['llm'];
export type MultimodalConfig = AgentConfig['multimodal'];
export type AdvancedConfig = DeepclawConfig['advanced'];

export type MissingAppConfig = (string|{[key in keyof Partial<DeepclawConfig>]: {[key: number]: string[]}})[];

const initialConfig = validateAppConfig(loadAppConfig());
const globalDeepclawConfig: {config: DeepclawConfig, valid: boolean} =
    globalize('globalDeepclawConfig', {config: initialConfig.config, valid: initialConfig.lacks.length === 0});

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
        if (!agent.im) {
            agent.im = {} as IMConfig;
        }
        if (!agent.multimodal) {
            agent.multimodal = {} as MultimodalConfig;
        }
        adoptLegacyImageKeys(agent);
    }
    const activeAgents = appConfig.agents.filter(agent => !agent.fired);
    if (activeAgents.length > MAX_AGENT_COUNT) {
        const active = activeAgents.slice(0, MAX_AGENT_COUNT);
        const fired = appConfig.agents.filter(agent => !!agent.fired);
        appConfig.agents = active.concat(fired);
    }
    if (!appConfig.advanced) {
        appConfig.advanced = {} as AdvancedConfig;
    }
}

/** Drawing used to be part of the llm section, which it never had anything to do with. */
function adoptLegacyImageKeys(agent: AgentConfig): void {
    const llm = agent.llm as LLMConfig & Partial<MultimodalConfig>;
    if (!llm) {
        return;
    }
    agent.multimodal.imageModel ??= llm.imageModel;
    agent.multimodal.imageApiKey ??= llm.imageApiKey;
    delete llm.imageModel;
    delete llm.imageApiKey;
}

export function validateCurrentAppConfig(): {config: DeepclawConfig, lacks: MissingAppConfig} {
    return validateAppConfig(globalDeepclawConfig.config);
}

export function validateAppConfig(configToValidate: Partial<DeepclawConfig>): {
    config: DeepclawConfig, lacks: MissingAppConfig
} {
    const lacks: MissingAppConfig = [];
    const cloned: DeepclawConfig = clone<DeepclawConfig>(configToValidate as DeepclawConfig);
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
                agent.im = {} as IMConfig;
            }
            if (typeof agent.im.enabled !== 'boolean') {
                agent.im.enabled = false;
                agentLacks.push('im.enabled');
            }
            if (agent.im.enabled) {
                if (!agent.im.engine || !['dingtalk', 'feishu'].includes(agent.im.engine)) {
                    agent.im.engine = undefined;
                    agentLacks.push('im.engine');
                }
                if (!agent.im.appId || typeof agent.im.appId !== 'string') {
                    agent.im.appId = undefined;
                    agentLacks.push('im.appId');
                }
                if (!agent.im.secret || typeof agent.im.secret !== 'string') {
                    agent.im.secret = undefined;
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
            if (!agent.multimodal) {
                agent.multimodal = {} as MultimodalConfig;
            }
            if (agent.multimodal.imageModel && !IMAGE_MODELS.includes(agent.multimodal.imageModel)) {
                agent.multimodal.imageModel = undefined;
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
    globalDeepclawConfig.valid = validateCurrentAppConfig().lacks.length === 0;
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

export function isCurrentConfigValid(): boolean {
    return globalDeepclawConfig.valid;
}
