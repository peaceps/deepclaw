import config from '@config';

type AgentConfigSingleValue = string | number | boolean;

type AgentConfigValue = AgentConfigSingleValue | AgentConfigSingleValue[] | undefined;

type ConfigObject = {[key: string]: AgentConfigValue | ConfigObject};

const defaultConfig: typeof config = {
    agent: {
        toolResult: {
            truncate: {
                lengthThreshold: 20000,
                persistResultDir: 'tool_results',
                previewLength: 1000
            },
            removeLegacy: {
                maxRecent: 1,
                lengthThreshold: 120
            }
        },
        history: {
            compactThreshold: 50000,
            dir: 'history'
        },
        llmRetry: 3,
        sessionDir: '.session',
        skillsDir: 'src/agent/skills',
        identityFile: 'DEEPCLAW.md'
    }
}

const clone = mergeAbsence({}, config);
const mergedConfig = Object.freeze(mergeAbsence(clone, defaultConfig));

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

export function loadAgentConfig<T extends AgentConfigValue>(key: string): T {
    return getConfigValue<T>(`agent.${key}`);
}

export function loadUIConfig<T extends AgentConfigValue>(key: string): T {
    return getConfigValue<T>(`ui.${key}`);
}

function getConfigValue<T>(key: string): T {
    const keyPath = key.split('.');
    let value: any = mergedConfig;
    for (const key of keyPath) {
        value = value?.[key as keyof typeof value];
    }
    return value as T;
}
