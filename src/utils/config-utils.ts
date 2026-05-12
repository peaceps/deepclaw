import config from '@config';

type AgentConfigSingleValue = string | number | boolean;

type AgentConfigValue = AgentConfigSingleValue | AgentConfigSingleValue[] | undefined;

export function loadAgentConfig<T extends AgentConfigValue>(key: string): T {
    return getConfigValue<T>(`agent.${key}`);
}

export function loadUIConfig<T extends AgentConfigValue>(key: string): T {
    return getConfigValue<T>(`ui.${key}`);
}

function getConfigValue<T>(key: string): T {
    const keyPath = key.split('.');
    let value: any = config;
    for (const key of keyPath) {
        value = value[key as keyof typeof value];
    }
    return value as T;
}
