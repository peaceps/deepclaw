import { ToolUnion } from '@anthropic-ai/sdk/resources.js';
import { LoopMessageParam, OneLoopContext} from '../definitions.js';
import { SkillsManager } from '../services/skills-manager.js';

export const TOOL_USE: string = 'tool_use' as const;
export const TOOL_RESULT: string = 'tool_result' as const;

export type ToolUseResult = {
    type: typeof TOOL_RESULT;
    tool_use_id: string;
    content: string;
}

export type ToolGuardResult = {
    allowed: boolean;
    feedback?: string;
}

export type ToolUseContext = {
    history: LoopMessageParam[];
    skillsManager: SkillsManager;
    oneLoopContext: OneLoopContext;
}

export type ToolCallback<T = unknown> = (input: T, context: ToolUseContext) => Promise<string>;

export type ToolDesc<T = unknown> = {
    tool: ToolUnion;
    invoke: ToolCallback<T>;
    outputToUser?: boolean;
    guard?: (input: T) => ToolGuardResult;
}