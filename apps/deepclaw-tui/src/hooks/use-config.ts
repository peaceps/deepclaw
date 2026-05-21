import { AgentEvent } from '@deepclaw/core';
import { validateEnvFile, EnvConfig, writeEnvConfig, DeepclawConfig, validateAppConfig, writeAppConfig} from '@deepclaw/utils';
import {useState, useEffect} from 'react';

export function useConfig(handleAgentEvent: (event: AgentEvent) => Promise<string>): boolean {
    const [configReady, setConfigReady] = useState<boolean>(false);
    useEffect(() => {
        ensureConfig(setConfigReady, handleAgentEvent);
    }, [handleAgentEvent]);
    return configReady;
}

const ENV_CONFIG_EVENTS: {[key in keyof EnvConfig]: AgentEvent} = {
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

const APP_CONFIG_EVENTS: {[key: string]: AgentEvent} = {
    ['ui.lang']: {
        key: 'lang',
        type: 'select',
        content: 'config.app.lang.prompt',
        options: [
            {label: 'config.app.lang.options.zh', value: 'zh'},
            {label: 'config.app.lang.options.en', value: 'en'},
        ],
    },
    ['agent.mode']: {
        type: 'select',
        content: 'config.app.agentMode.prompt',
        options: [
            {label: 'config.app.agentMode.options.agent', value: 'agent'},
            {label: 'config.app.agentMode.options.plan', value: 'plan'},
            {label: 'config.app.agentMode.options.chat', value: 'chat'},
        ],
    },
    ['agent.headlessEnabled']: {
        type: 'select',
        content: 'config.app.headless.prompt',
        options: [
            {label: 'common.yes', value: 'true'},
            {label: 'common.no', value: 'false'},
        ],
    },
    ['im.engine']: {
        type: 'select',
        content: 'config.app.im.engine.prompt',
        options: [
            {label: 'config.app.im.engine.options.dingtalk', value: 'dingtalk'},
            {label: 'config.app.im.engine.options.feishu', value: 'feishu'},
        ],
    },
    ['im.appId']: {
        type: 'input',
        content: 'config.app.im.appId'
    },
    ['im.secret']: {
        type: 'input',
        content: 'config.app.im.secret'
    }
};

const HINT: AgentEvent = {
    type: 'readonly',
    content: 'config.env.hint'
};

async function ensureConfig(
    setConfigReady: React.Dispatch<React.SetStateAction<boolean>>,
    handleAgentEvent: (event: AgentEvent) => Promise<string>,
) {
    const appConfig = validateAppConfig(false);
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
    setConfigReady(true);
}

async function ensureAppConfig(
    {config, lacks}: {config: DeepclawConfig, lacks: string[]},
    handleAgentEvent: (event: AgentEvent) => Promise<string>,
) {
    for (const lack of lacks) {
        const event = APP_CONFIG_EVENTS[lack]!;
        const answer = await handleAgentEvent(event);
        setConfigValue(config, lack, answer);
    }
    if (config.agent.headlessEnabled === 'true') {
        config.agent.im = {engine: 'dingtalk', appId: '', secret: ''};
        for (const key of ['engine', 'appId', 'secret']) {
            const event = APP_CONFIG_EVENTS[`im.${key}`]!;
            const answer = await handleAgentEvent(event);
            setConfigValue(config.agent.im, key, answer);
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
    handleAgentEvent: (event: AgentEvent) => Promise<string>
): Promise<void> {
    for (const lack of lacks) {
        const event = ENV_CONFIG_EVENTS[lack]!;
        const answer = await handleAgentEvent(event);
        config[lack] = answer;
    }
    writeEnvConfig(config as EnvConfig);
}
