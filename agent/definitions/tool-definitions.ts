import { OneLoopContext } from './definitions.js';
import { LoopAgent } from '../loop/loop/loop.js';

export type LLMTool = {
    name: string;
    description: string;
    schema: {
        type: 'object';
        properties?: unknown | null;
        required?: Array<string> | null;
        [k: string]: unknown;
    }
}

export type ToolUseResult = {
    id: string;
    content: string;
}

export type ToolGuardResult = {
    allowed: boolean;
    feedback?: string;
}

export type ToolUseContext = {
    loop: LoopAgent<any, any, any>;
    oneLoopContext: OneLoopContext;
}

export type ToolCallback<T = unknown> = (input: T, context: ToolUseContext) => Promise<string>;

export type ToolDesc<T = unknown> = {
    tool: LLMTool;
    invoke: ToolCallback<T>;
    outputToUser?: boolean;
    guard?: (input: T) => ToolGuardResult;
}