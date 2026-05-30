import { AgentInteractionEvent } from '@deepclaw/core';
import {validateAndFixConfig} from '@deepclaw/config';
import {useState, useEffect} from 'react';

export function useConfig(handleAgentEvent: (event: AgentInteractionEvent) => Promise<string>): boolean {
    const [configReady, setConfigReady] = useState<boolean>(false);
    useEffect(() => {
        validateAndFixConfig(handleAgentEvent).then(() => setConfigReady(true));
    }, [handleAgentEvent]);
    return configReady;
}
