import type { Logger } from '@deepclaw/utils';
import { type FlushAgent } from '@deepclaw/core';

export type TodoItem = {
    content: string;
    status: 'pending' | 'inProgress' | 'completed';
    activeForm?: string;
}

export type FootPrint = {
    type: string;
    content: string;
}

export type LoopState<I> = {
    messages: I[];
    oneLoopContext: OneLoopContext;
}

export type OneLoopContext = {
    turnCount: number;
    transitionReason?: 'toolResult' | 'noToolUse';
    system: string;
    logger: Logger;
    actions: {
        newSubLoop: (fork?: boolean) => FlushAgent;
        remindTodoIfNeeded: () => void;
        updateTodo: (items: TodoItem[]) => string;
        addFootPrint: (footPrint: FootPrint) => void;
        compactIfNeeded: () => Promise<void>;
    }
}
