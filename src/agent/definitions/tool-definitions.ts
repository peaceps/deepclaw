import { OneLoopContext } from './definitions.js';
import { LoopAgent } from '../loop/loop/loop.js';
import { DeepclawConfig } from '@utils';
import i18n from 'i18next';

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
    result: 'allowed';
} | {
    result: 'denied';
    reason: string;
} | {
    result: 'ask';
    question: string;
    checkAnswer: (answer: string) => boolean;
}

export type ToolUseContext = {
    loop: LoopAgent<any, any, any>;
    oneLoopContext: OneLoopContext;
}

export type ToolCallback<T = unknown> = (input: T, context: ToolUseContext) => Promise<string>;

export type ToolDesc<T = unknown> = {
    tool: LLMTool;
    parallelSafe: boolean;
    agentMode: DeepclawConfig['agent']['mode'][];
    exclusiveInSubLoop?: boolean; // if true, the tool will not be available in sub-loop
    invoke: ToolCallback<T>;
    outputToUser?: boolean;
    guard?: (input: T) => ToolGuardResult;
}

export function askPermissionGuard(reason: string): ToolGuardResult {
    return {
        result: 'ask',
        question: `${reason}${i18n.t('agent.tools.permission.request')}`,
        checkAnswer: (answer: string) => {
            return answer.trim().toLowerCase() === 'y';
        }
    }
}