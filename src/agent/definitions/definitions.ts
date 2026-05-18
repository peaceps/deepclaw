import { TodoManager } from '../loop/services/todo-manager.js';
import type { Logger } from 'pino';

export type LoopState<I> = {
    messages: I[];
    oneLoopContext: OneLoopContext;
}

export type OneLoopContext = {
    toDoManager: TodoManager;
    toDoUpdated: boolean;
    turnCount: number;
    transitionReason?: 'toolResult' | 'noToolUse';
    footPrints: FootPrint[];
    logger: Logger;
}

export type FootPrint = {
    type: string;
    content: string;
}
