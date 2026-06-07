import {AgentInteractionEvent} from "@deepclaw/core";
import {validateEnvFile, EnvConfig, writeEnvConfig} from "./env-config";
import {DeepclawConfig, MissingAppConfig, validateAppConfig, writeAppConfig} from "./app-config";
import { FileUtils } from "@deepclaw/utils";

const ENV_CONFIG_EVENTS: {[key in keyof EnvConfig]: AgentInteractionEvent} = {
    provider: {
        type: 'select',
        content: 'config.env.provider.prompt',
        options: [
            {label: 'config.env.provider.options.openai', value: 'openai'},
            {label: 'config.env.provider.options.anthropic', value: 'anthropic'},
        ],
    },
    baseUrl: {
        type: 'input',
        content: 'config.env.baseUrl'
    },
    apiKey: {
        type: 'input',
        content: 'config.env.apiKey'
    },
    model: {
        type: 'input',
        content: 'config.env.model'
    },
    responseApi: {
        type: 'select',
        content: 'config.env.responseApi.prompt',
        options: [
            {label: 'config.env.responseApi.options.yes', value: 'TRUE'},
            {label: 'config.env.responseApi.options.no', value: 'FALSE'}
        ]
    }
};

const APP_CONFIG_EVENTS: {[key: string]: AgentInteractionEvent} = {
    ['ui.lang']: {
        key: 'lang',
        type: 'select',
        content: 'config.app.lang.prompt',
        options: [
            {label: 'config.app.lang.options.zh', value: 'zh'},
            {label: 'config.app.lang.options.en', value: 'en'},
        ],
    },
    ['agents.mode']: {
        type: 'select',
        content: 'config.app.agentMode.prompt',
        options: [
            {label: 'config.app.agentMode.options.agent', value: 'agent'},
            {label: 'config.app.agentMode.options.plan', value: 'plan'},
            {label: 'config.app.agentMode.options.chat', value: 'chat'},
        ],
    },
    ['agents.headlessEnabled']: {
        type: 'select',
        content: 'config.app.headless.prompt',
        options: [
            {label: 'common.yes', value: 'true'},
            {label: 'common.no', value: 'false'},
        ],
    },
    ['agents.im.engine']: {
        type: 'select',
        content: 'config.app.im.engine.prompt',
        options: [
            {label: 'config.app.im.engine.options.dingtalk', value: 'dingtalk'},
            {label: 'config.app.im.engine.options.feishu', value: 'feishu'},
        ],
    },
    ['agents.im.appId']: {
        type: 'input',
        content: 'config.app.im.appId'
    },
    ['agents.im.secret']: {
        type: 'input',
        content: 'config.app.im.secret'
    }
};

const HINT: AgentInteractionEvent = {
    type: 'readonly',
    content: 'config.env.hint'
};

export async function validateAndFixConfig(
    handleAgentEvent: (event: AgentInteractionEvent) => Promise<string>,
    headless: boolean = false,
) {
    const appConfig = validateAppConfig(headless);
    const envConfig = validateEnvFile();
    if (appConfig.lacks.length > 0 || envConfig.lacks.length > 0) {
        await handleAgentEvent(HINT);
        if (appConfig.lacks.length > 0) {
            await ensureAppConfig(appConfig, handleAgentEvent);
        }
        if (envConfig.lacks.length > 0) {
            await ensureEnvConfig(envConfig, handleAgentEvent);
        }
    }
    ensureBasicFiles();
}

async function ensureAppConfig(
    {config, lacks}: {config: DeepclawConfig, lacks: MissingAppConfig},
    handleAgentEvent: (event: AgentInteractionEvent) => Promise<string>,
) {
    for (const lack of lacks) {
        if (typeof lack === 'string') {
            const event = APP_CONFIG_EVENTS[lack]!;
            const answer = await handleAgentEvent(event);
            setConfigValue(config, lack, answer);
        } else {
            for (const key of Object.keys(lack)) {
                const subArrayConfig = config[key as keyof DeepclawConfig] as any[];
                for (const index of Object.keys(lack[key as keyof DeepclawConfig]!)) {
                    const subConfig = subArrayConfig[index as unknown as number];
                    const subLacks = lack[key as keyof DeepclawConfig]![index as unknown as number]!;

                    for (const subLack of subLacks) {
                        const event = APP_CONFIG_EVENTS[`${key}.${subLack}`]!;
                        const answer = await handleAgentEvent(event);
                        setConfigValue(subConfig, subLack, answer);
                    }
                    if (key === 'agents') {
                        // for non-headless
                        if (subConfig.headlessEnabled === 'true' && !subConfig.im) {
                            subConfig.im = {} as DeepclawConfig['agents'][0]['im'];
                            for (const key of ['engine', 'appId', 'secret']) {
                                const event = APP_CONFIG_EVENTS[`agents.im.${key}`]!;
                                const answer = await handleAgentEvent(event);
                                setConfigValue(subConfig.im, key, answer);
                            }
                        }
                    }
                }
            }
        }
    }
    writeAppConfig(config);
}

function setConfigValue(target: any, path: string, value: any) {
    const keys = path.split('.');
    let current = target;
    for (let i = 0; i < keys.length; i++) {
        if (i === keys.length - 1) {
            current[keys[i]!] = value;
        } else {
            current = current[keys[i]!];
        }
    }
}

async function ensureEnvConfig(
    {config, lacks}: {config: Partial<EnvConfig>, lacks: (keyof EnvConfig)[]},
    handleAgentEvent: (event: AgentInteractionEvent) => Promise<string>
): Promise<void> {
    for (const lack of lacks) {
        const event = ENV_CONFIG_EVENTS[lack]!;
        const answer = await handleAgentEvent(event);
        config[lack] = answer;
    }
    writeEnvConfig(config as EnvConfig);
}

function ensureBasicFiles() {
    FileUtils.copyResource(import.meta.dirname, 'DEEPCLAW.md');
    FileUtils.copyResource(import.meta.dirname, 'skills');
}
