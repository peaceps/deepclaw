import {getEnvVariable, hasEnvVariable, type Logger} from '@deepclaw/utils';
import { AgentStreamHandler, noopStreamHandler } from '@deepclaw/core';
import { LLMTool } from '../definitions/tool-definitions.js';
import { TransitionReason } from '../definitions/definitions.js';

const llmRetry = 3;

export type LLMConstructor<I, O, T, LLM> = new (tools: LLMTool[]) => LLMModel<I, O, T, LLM>;

export abstract class LLMModel<I, O, T, LLM> {
    protected client: LLM;
    protected tools?: T[];
    protected gw = {
        model: getEnvVariable('MODEL_ID'),
        headers: !hasEnvVariable('WORKSPACE_NAME') ? undefined : {
            'api-key': getEnvVariable('OPENAI_API_KEY'),
            'workspacename': getEnvVariable('WORKSPACE_NAME'),
        },
        timeoutMs: 300 * 1000, // JSON: seconds → client: ms
        temperature: 0.1,
        maxTokens: 8000
    };

    constructor(tools: LLMTool[] = []) {
        this.tools = this.convertTools(tools);
        this.client = this.createLLMClient();
    }
    
    protected abstract convertTools(tools: LLMTool[]): T[];

    protected abstract createLLMClient(): LLM;

    public async invoke(system: string, messages: I[], streamHandler: AgentStreamHandler, logger: Logger): Promise<O> {
        let response: O | null = null;
        for (let i = 0; i < llmRetry; i++) {
            try {
                response = await this._invoke(system, messages, streamHandler);
                break;
            } catch (error) {
                logger.error(error, 'LLM invoke failed');
                const unrecoverableError = this.isUnrecoverableError(error);
                if (unrecoverableError) {
                    response = this.newResponse(`ERROR: Unrecoverable error: ${unrecoverableError}.`, 'error');
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        if (!response) {
            response = this.newResponse(`ERROR: LLM invoke failed after ${llmRetry} retries.`, 'error');
        }
        messages.push(...this.convertResponseToMessages(response));
        return response;
    }

    private isUnrecoverableError(error: any): string {
        const code = error?.status;
        if (code === 429 || code === 403 || code === 401 || code === 404) {
            return error?.message ?? code.toString();
        }
        return '';
    }

    protected abstract _invoke(system: string, messages: I[], streamHandler: AgentStreamHandler): Promise<O>;

    public async compact(system: string, content: string, logger: Logger): Promise<string> {
        const prompt =
`Summarize this agent conversation so work can continue.
Preserve:
1. The current goal
2. Important findings and decisions
3. Files read or changed
4. Remaining work
5. User constraints and preferences
6. The step to take next, which is the most important thing

Be compact but concrete.

${content}`;
        const response = await this.invoke(system, [this.newInputMessage(prompt)], noopStreamHandler, logger);
        return this.getTextFromResponse(response);
    }
    
    public newInputMessage(content: string): I {
        return {role: 'user', content} as I;
    }

    protected abstract setTransitionReason(response: O): O;

    protected abstract newResponse(content: string, transitionReason?: TransitionReason): O;

    protected abstract convertResponseToMessages(response: O): I[];

    protected abstract getTextFromResponse(response: O): string;

    public abstract getTextFromInputMessage(message: I): string;

}
