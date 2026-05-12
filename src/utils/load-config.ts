import config from '@config';

export function loadAgentConfig(key: string): string | number {
    return config.agent[key as keyof typeof config.agent];
}
