import { ToolUseResult } from './tool-definitions.js';
import { TodoManager } from '../loop/services/todo-manager.js';

export type LoopMessageParam<I> = {
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: LoopContent<I>[] | string;
    [key: string]: any;
}

export type LoopState<I> = {
    messages: LoopMessageParam<I>[];
    oneLoopContext: OneLoopContext;
}

export type OneLoopContext = {
    toDoManager: TodoManager;
    toDoUpdated: boolean;
    turnCount: number;
    transitionReason?: 'tool_result' | 'no_tool_use';
}

export type LoopContent<I> = ToolUseResult | I;