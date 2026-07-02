import { AgentInteractionEventConfig } from '@deepclaw/core';
import {validateAndFixCurrentConfig} from '@deepclaw/config';
import {useState, useEffect} from 'react';

export function useConfig(handleAgentEvent: (event: AgentInteractionEventConfig) => Promise<string>): boolean {
    const [configReady, setConfigReady] = useState<boolean>(false);
    useEffect(() => {
        validateAndFixCurrentConfig(handleAgentEvent).then(() => setConfigReady(true));
    }, [handleAgentEvent]);
    return configReady;
}
