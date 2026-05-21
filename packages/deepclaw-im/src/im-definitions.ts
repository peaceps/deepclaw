import type { FlushAgent } from '@deepclaw/core';

export type IM = {
    connect: (appId: string, secret: string, agent: FlushAgent) => {
        disconnect: () => void;
    };
}
