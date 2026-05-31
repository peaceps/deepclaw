import type { FlushAgentConstructor } from '@deepclaw/core';

export type IM = {
    connect: (appId: string, secret: string, agentClass: FlushAgentConstructor) => {
        disconnect: () => void;
    };
}
