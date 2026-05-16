import { AgentEvent } from '@core';
import { validateEnvFile, EnvConfig, writeEnvConfig} from '@utils';
import {useState, useEffect} from 'react';

export function useEnvConfig(handleAgentEvent: (event: AgentEvent) => Promise<string>): boolean {
    const [envConfigReady, setEnvConfigReady] = useState<boolean>(false);
    useEffect(() => {
        ensureEnvConfig(setEnvConfigReady, handleAgentEvent);
    }, [handleAgentEvent]);
    return envConfigReady;
}

const CONFIG_EVENTS: {[key in keyof EnvConfig]: AgentEvent} = {
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

const HINT: AgentEvent = {
    type: 'readonly',
    content: 'Your env config seems to be incomplete, Deepclaw will lead you to finish the env config, press enter to continue...'
};

async function ensureEnvConfig(
    setEnvConfigReady: React.Dispatch<React.SetStateAction<boolean>>,
    handleAgentEvent: (event: AgentEvent) => Promise<string>
) {
    const currentConfig = validateEnvFile();
    const keys: (keyof EnvConfig)[] = ['provider', 'baseUrl', 'apiKey', 'model'];
    const lacks = keys.filter(key => !(key in currentConfig))
    if (lacks.length > 0) {
        await handleAgentEvent(HINT);
    }
    for (const lack of lacks) {
        if (currentConfig.provider !== 'openai' && lack === 'responseApi') {
            continue;
        }
        const event = CONFIG_EVENTS[lack]!;
        const answer = await handleAgentEvent(event);
        currentConfig[lack] = answer;
    }
    if (currentConfig.provider === 'openai' && !('responseApi' in currentConfig)) {
        currentConfig.responseApi = await handleAgentEvent(CONFIG_EVENTS.responseApi!)
    }
    writeEnvConfig(currentConfig as EnvConfig);
    setEnvConfigReady(true);
}