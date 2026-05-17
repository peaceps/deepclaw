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
        content: 'Which LLM provider will be used?',
        options: [
            {label: 'OpenAI', value: 'openai'},
            {label: 'Anthropic', value: 'anthropic'},
        ],
    },
    baseUrl: {
        type: 'input',
        content: 'Please enter the base URL:'
    },
    apiKey: {
        type: 'input',
        content: 'Please enter the API key:'
    },
    model: {
        type: 'input',
        content: 'Please enter the LLM model name:'
    },
    responseApi: {
        type: 'select',
        content: 'Will you use the OPENAI Response API?',
        options: [{label: 'Yes', value: 'TRUE'}, {label: 'No', value: 'FALSE'}]
    }
};

const APP_CONFIG_EVENTS: {[key: string]: AgentEvent} = {
    agentMode: {
        type: 'select',
        content: 'Which agent mode should be in use?',
        options: [
            {label: 'Agent (Operate the OS, with all capability to the files on the computer)', value: 'agent'},
            {label: 'Plan (Only do the plan, won\'t do any real operation)', value: 'plan'},
            {label: 'Chat (A chat tool, won\'t do any operation)', value: 'chat'},
        ],
    }
};

const HINT: AgentEvent = {
    type: 'readonly',
    content: 'Your env config seems to be incomplete, Deepclaw will lead you to finish the env config, press enter to continue...'
};

async function ensureConfig(
    setConfigReady: React.Dispatch<React.SetStateAction<boolean>>,
    handleAgentEvent: (event: AgentEvent) => Promise<string>
) {
    await ensureEnvConfig(handleAgentEvent);
    await ensureAppConfig(handleAgentEvent);
    setConfigReady(true);
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

async function ensureAppConfig(
    handleAgentEvent: (event: AgentEvent) => Promise<string>
) {
    const currentConfig: DeepclawConfig = validateAppConfig();
    if (!currentConfig.agent.mode) {
        const answer = await handleAgentEvent(APP_CONFIG_EVENTS['agentMode']!);
        currentConfig.agent.mode = answer as 'agent' | 'plan' | 'chat';
    }
    writeAppConfig(currentConfig);
}