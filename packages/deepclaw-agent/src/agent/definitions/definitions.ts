import type { Logger } from '@deepclaw/utils';
import { SealedAgentHandler, type FlushAgent } from '@deepclaw/core';

export type FootPrint = {
    type: string;
    content: string;
}

export type TransitionReason = 'endLoop' | 'toolUse' | 'maxTokens' | 'inputMaxTokens' | 'refused' | 'error';

export type LoopState<I> = {
    messages: I[];
    oneLoopContext: OneLoopContext;
}

export type OneLoopContext = {
    turnCount: number;
    transitionReason?: TransitionReason;
    system: string;
    logger: Logger;
    recoveryState: {
        maxTokenRetries: number;
        refusalState: '' // TODO: 添加拒绝状态
    },
    actions: {
        newSubLoop: (fork?: boolean) => FlushAgent;
        addFootPrint: (footPrint: FootPrint) => void;
        compactIfNeeded: () => Promise<void>;
        agentHandler: SealedAgentHandler;
    }
}
