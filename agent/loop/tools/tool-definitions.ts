import { ToolUnion } from '@anthropic-ai/sdk/resources.js';
import { LoopMessageParam, OneLoopContext} from '../definitions.js';

export const TOOL_RESULT_TYPE: string = 'tool_result' as const;

export type ToolUseResult = {
    type: typeof TOOL_RESULT_TYPE;
    tool_use_id: string;
    content: string;
}

export type ToolGuardResult = {
    allowed: boolean;
    feedback?: string;
}

export type ToolCallback<T = unknown> = (input: T, context?: OneLoopContext, history?: LoopMessageParam[]) => Promise<string>;

export type ToolDesc<T = unknown> = {
    tool: ToolUnion;
    invoke: ToolCallback<T>;
    outputToUser?: boolean;
    guard?: (input: T) => ToolGuardResult;
}