import { MessageParam, ContentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages.js';
import { ToolUseResult } from './tools/tool-definitions.js';
import { TodoManager } from './services/todo-manager.js';

export type LoopMessageParam = {
    role: MessageParam['role'];
    content: LoopContent[] | string;
}

export type LoopState = {
    messages: LoopMessageParam[];
    oneLoopContext: OneLoopContext;
}

export type OneLoopContext = {
    toDoManager: TodoManager;
    toDoUpdated: boolean;
    turnCount: number;
    transitionReason?: string;
}

export type LoopContent = ToolUseResult | ContentBlockParam;