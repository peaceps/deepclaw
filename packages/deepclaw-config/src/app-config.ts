import { FileUtils } from '@deepclaw/utils';

const APP_CONFIG_FILE = '.deepclaw.config.json';

type AgentConfigSingleValue = string | number | boolean;
type AgentConfigValue = AgentConfigSingleValue | AgentConfigSingleValue[] | undefined;
type ConfigObject = {[key: string]: AgentConfigValue | ConfigObject | ConfigObject[]};

export type DeepclawConfig = {
    agents: {
        name: string;
        headlessEnabled?: string;
        im?: {
            engine: 'dingtalk' | 'feishu';
            appId: string;
            secret: string;
        },
        mode?: 'agent' | 'plan' | 'chat';
        standaloneTask: 'transient' | 'persistent' | 'ask';
    }[],
    ui: {
        lang?: string;
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
    if (cloned.ui.lang && !['en', 'zh'].includes(cloned.ui.lang)) {
        cloned.ui.lang = undefined;
    }
    if (!cloned.ui.lang) {
        lacks.push('ui.lang');
    }
    if (!cloned.agents?.length) {
        cloned.agents = [{
            name: 'main',
            standaloneTask: 'transient',
        }];
        lacks.push({agents: {0: ['mode', 'headlessEnabled']}});
    } else {
        cloned.agents.forEach((agent) => {
            if (agent.mode && !['agent', 'plan', 'chat'].includes(agent.mode)) {
                agent.mode = undefined;
            }
            if (!agent.mode) {
                lacks.push(`mode`);
            }
            if (agent.headlessEnabled && !['true', 'false'].includes(agent.headlessEnabled)) {
                agent.headlessEnabled = undefined;
            }
            if (!headless && !agent.headlessEnabled) {
                lacks.push(`headlessEnabled`);
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
                lacks.push(`im.engine`, `im.appId`, `im.secret`);
            }
        });
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
