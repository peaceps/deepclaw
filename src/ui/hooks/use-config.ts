import { AgentEvent } from '@core';
import { validateEnvFile, EnvConfig, writeEnvConfig, DeepclawConfig, validateAppConfig, writeAppConfig} from '@utils';
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
    language: {
        key: 'lang',
        type: 'select',
        content: 'config.app.lang.prompt',
        options: [
            {label: 'config.app.lang.options.zh', value: 'zh'},
            {label: 'config.app.lang.options.en', value: 'en'},
        ],
    },
    agentMode: {
        type: 'select',
        content: 'config.app.agentMode.prompt',
        options: [
            {label: 'config.app.agentMode.options.agent', value: 'agent'},
            {label: 'config.app.agentMode.options.plan', value: 'plan'},
            {label: 'config.app.agentMode.options.chat', value: 'chat'},
        ],
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
    await ensureAppConfig(handleAgentEvent);
    await ensureEnvConfig(handleAgentEvent);
    setConfigReady(true);
}

async function ensureAppConfig(
    handleAgentEvent: (event: AgentEvent) => Promise<string>,
) {
    const currentConfig: DeepclawConfig = validateAppConfig();
    const noLang = !currentConfig.ui.lang;
    if (noLang) {
        const answer = await handleAgentEvent(APP_CONFIG_EVENTS['language']!);
        currentConfig.ui.lang = answer;
    }
    if (!currentConfig.agent.mode) {
        const answer = await handleAgentEvent(APP_CONFIG_EVENTS['agentMode']!);
        currentConfig.agent.mode = answer as 'agent' | 'plan' | 'chat';
    }
    writeAppConfig(currentConfig);
}

async function ensureEnvConfig(
    handleAgentEvent: (event: AgentEvent) => Promise<string>
) {
    const currentConfig = validateEnvFile();
    const keys: (keyof EnvConfig)[] = ['provider', 'baseUrl', 'apiKey', 'model'];
    const lacks = keys.filter(key => !(key in currentConfig))
    if (lacks.length > 0) {
        await handleAgentEvent(HINT);
    }
    for (const lack of lacks) {
        const event = ENV_CONFIG_EVENTS[lack]!;
        const answer = await handleAgentEvent(event);
        currentConfig[lack] = answer;
    }
    if (currentConfig.provider === 'openai' && !('responseApi' in currentConfig)) {
        currentConfig.responseApi = await handleAgentEvent(ENV_CONFIG_EVENTS.responseApi!)
    }
    writeEnvConfig(currentConfig as EnvConfig);
}
