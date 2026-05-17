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
        llmRetry: number;
        identityFile: string;
    },
};

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
            compactThreshold: 50000,
        },
        llmRetry: 3,
        identityFile: 'DEEPCLAW.md'
    }
}

let deepclawConifg: DeepclawConfig = loadAppConfig();

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
    return deepclawConifg;
}

export function writeAppConfig(config: DeepclawConfig) {
    FileUtils.writeFile(APP_CONFIG_FILE, JSON.stringify(config, null, 2));
    deepclawConifg = loadAppConfig();
}

export function loadAgentConfig<T extends AgentConfigValue>(key: string): T {
    return getConfigValue<T>(`agent.${key}`);
}

export function loadUIConfig<T extends AgentConfigValue>(key: string): T {
    return getConfigValue<T>(`ui.${key}`);
}

function getConfigValue<T>(key: string): T {
    const keyPath = key.split('.');
    let value: any = deepclawConifg;
    for (const key of keyPath) {
        value = value?.[key as keyof typeof value];
    }
    return value as T;
}
