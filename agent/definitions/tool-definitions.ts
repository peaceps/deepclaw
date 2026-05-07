import { LoopMessageParam, OneLoopContext } from './definitions.js';
import { SkillsManager } from '../loop/services/skills-manager.js';

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
    history: LoopMessageParam<any>[];
    skillsManager: SkillsManager;
    oneLoopContext: OneLoopContext;
}

export type ToolCallback<T = unknown> = (input: T, context: ToolUseContext) => Promise<string>;

export type ToolDesc<T = unknown> = {
    tool: LLMTool;
    invoke: ToolCallback<T>;
    outputToUser?: boolean;
    guard?: (input: T) => ToolGuardResult;
}