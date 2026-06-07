import { OneLoopContext } from './definitions';
import { DeepclawConfig } from '@deepclaw/config';
import { i18nInstance } from '@deepclaw/i18n';

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

export type ToolCallback<T = unknown> = (input: T, context: OneLoopContext) => Promise<string>;

export type ToolDesc<T = unknown> = {
    tool: LLMTool;
    parallelSafe: boolean;
    agentMode: DeepclawConfig['agents'][0]['mode'][];
    exclusiveInSubLoop?: boolean; // if true, the tool will not be available in sub-loop
    invoke: ToolCallback<T>;
    outputToUser?: boolean;
    guard?: (input: T, agentMode: DeepclawConfig['agents'][0]['mode']) => ToolGuardResult;
}

export function askPermissionGuard(reason: string): ToolGuardResult {
    return {
        result: 'ask',
        question: `${reason}${i18nInstance.t('agent.tools.permission.request')}`,
        checkAnswer: (answer: string) => {
            return answer.trim().toLowerCase() === 'y';
        }
    }
}