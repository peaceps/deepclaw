import { FileUtils } from './file-utils';

const APP_CONFIG_FILE = '.deepclaw.config.json';

type AgentConfigSingleValue = string | number | boolean;
type AgentConfigValue = AgentConfigSingleValue | AgentConfigSingleValue[] | undefined;
type ConfigObject = {[key: string]: AgentConfigValue | ConfigObject};

export type DeepclawConfig = {
    agent: {
        mode?: 'agent' | 'plan' | 'chat';
        toolResult: {
            truncate: {
                lengthThreshold: number;
                previewLength: number;
            },
            removeLegacy: {
                maxRecent: number;
                lengthThreshold: number;
            }
        },
        history: {
            compactThreshold: number;
        },
        loopTurnLimit: number;
        llmRetry: number;
        identityFile: string;
    },
    ui: {
        lang?: string;
    }
};

export const DEFAULT_LANG = 'en';

const defaultConfig: DeepclawConfig = {
    agent: {
        toolResult: {
            truncate: {
                lengthThreshold: 20000,
                previewLength: 1000
            },
            removeLegacy: {
                maxRecent: 1,
                lengthThreshold: 120
            }
        },
        history: {
            compactThreshold: 200000,
        },
        loopTurnLimit: 100,
        llmRetry: 3,
        identityFile: 'DEEPCLAW.md'
    },
    ui: {
    }
}

let deepclawConfig: DeepclawConfig = loadAppConfig();

function loadAppConfig(): DeepclawConfig {
    let appConfig: Partial<DeepclawConfig> = {};
    try {
        appConfig = JSON.parse(FileUtils.readFile(APP_CONFIG_FILE));
    } catch {
        // ignore malformed or missing config file
    }
    return Object.freeze(mergeAbsence(appConfig, defaultConfig)) as DeepclawConfig;
}

function mergeAbsence(target: ConfigObject, source: ConfigObject): ConfigObject {
    Object.keys(source).forEach(key => {
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

export function validateAppConfig(): DeepclawConfig {
    const cloned: DeepclawConfig = mergeAbsence({}, deepclawConfig) as DeepclawConfig;
    if (cloned.agent.mode && !['agent', 'plan', 'chat'].includes(cloned.agent.mode)) {
        cloned.agent.mode = undefined;
    }
    if (cloned.ui.lang && !['en', 'zh'].includes(cloned.ui.lang)) {
        cloned.ui.lang = undefined;
    }
    return cloned;
}

export function writeAppConfig(config: DeepclawConfig) {
    FileUtils.writeFile(APP_CONFIG_FILE, JSON.stringify(config, null, 2));
    deepclawConfig = loadAppConfig();
}

export function loadAgentConfig<T extends AgentConfigValue>(key: string): T {
    return getConfigValue<T>(`agent.${key}`);
}

export function loadUIConfig<T extends AgentConfigValue>(key: string): T {
    return getConfigValue<T>(`ui.${key}`);
}

function getConfigValue<T>(key: string): T {
    const keyPath = key.split('.');
    let value: any = deepclawConfig;
    for (const key of keyPath) {
        value = value?.[key as keyof typeof value];
    }
    return value as T;
}
