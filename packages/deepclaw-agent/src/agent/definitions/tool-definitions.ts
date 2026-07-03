import { OneLoopContext } from './definitions';
import { AgentMode } from '@deepclaw/config';
import { AgentInteractionEventPayload } from '@deepclaw/core';
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
    question: AgentInteractionEventPayload;
    checkAnswer: (answer: string) => boolean;
}

export type ToolCallback<T = unknown> = (input: T, context: OneLoopContext) => Promise<string>;

export type ToolDesc<T = unknown> = {
    tool: LLMTool;
    parallelSafe: boolean;
    agentMode: AgentMode[];
    exclusiveInSubLoop?: boolean; // if true, the tool will not be available in sub-loop
    invoke: ToolCallback<T>;
    guard?: (input: T, agentMode: AgentMode) => ToolGuardResult;
}

export function askPermissionGuard(reason: string): ToolGuardResult {
    return {
        result: 'ask',
        question: {
            type: 'select',
            content: `${reason}${i18nInstance.t('agent.tools.permission.request')}`,
            options: [
                { label: i18nInstance.t('agent.tools.permission.allow'), value: 'y' },
                { label: i18nInstance.t('agent.tools.permission.deny'), value: 'n' }
            ]
        },
        checkAnswer: (answer: string) => {
            return answer.trim().toLowerCase() === 'y';
        }
    }
}