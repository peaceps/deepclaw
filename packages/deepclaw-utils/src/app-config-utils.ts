import { FileUtils } from './file-utils';

const APP_CONFIG_FILE = '.deepclaw.config.json';

type AgentConfigSingleValue = string | number | boolean;
type AgentConfigValue = AgentConfigSingleValue | AgentConfigSingleValue[] | undefined;
type ConfigObject = {[key: string]: AgentConfigValue | ConfigObject};

export type DeepclawConfig = {
    agent: {
        headlessEnabled?: string;
        im?: {
            engine: 'dingtalk' | 'feishu';
            appId: string;
            secret: string;
        },
        mode?: 'agent' | 'plan' | 'chat';
        standaloneTask: 'transient' | 'persistent' | 'ask';
    },
    ui: {
        lang?: string;
    }
};

export const DEFAULT_LANG = 'en';

const defaultConfig: DeepclawConfig = {
    agent: {
        standaloneTask: 'transient',
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

export function validateAppConfig(headless: boolean): {config: DeepclawConfig, lacks: string[]} {
    const lacks: string[] = [];
    const cloned: DeepclawConfig = mergeAbsence({}, deepclawConfig) as DeepclawConfig;
    if (cloned.ui.lang && !['en', 'zh'].includes(cloned.ui.lang)) {
        cloned.ui.lang = undefined;
    }
    if (!cloned.ui.lang) {
        lacks.push('ui.lang');
    }
    if (cloned.agent.mode && !['agent', 'plan', 'chat'].includes(cloned.agent.mode)) {
        cloned.agent.mode = undefined;
    }
    if (!cloned.agent.mode) {
        lacks.push('agent.mode');
    }
    if (cloned.agent.headlessEnabled && !['true', 'false'].includes(cloned.agent.headlessEnabled)) {
        cloned.agent.headlessEnabled = undefined;
    }
    if (!cloned.agent.headlessEnabled) {
        lacks.push('agent.headlessEnabled');
    }
    if (cloned.agent.im && cloned.agent.im.engine && !['dingtalk', 'feishu'].includes(cloned.agent.im.engine)) {
        cloned.agent.im = undefined;
    }
    if (headless && !cloned.agent.im) {
        lacks.push('agent.im');
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
