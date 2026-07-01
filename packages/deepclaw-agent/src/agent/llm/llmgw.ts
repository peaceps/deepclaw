import {AgentMode, LLMConfig} from '@deepclaw/config';
import {type Logger, type CommonKeys} from '@deepclaw/node-utils';
import { LLMTool } from '../definitions/tool-definitions';
import { TransitionReason } from '../definitions/definitions';
import { LLMGWConfig } from '@deepclaw/core';
import { ToolsManager } from '../loop/services/tools-manager';

const llmRetry = 3;

export type LLMConstructor<I, O, T, LLM> = new (isSubLoop: boolean, llmConfig: LLMConfig) => LLMModel<I, O, T, LLM>;

export abstract class LLMModel<I, O, T, LLM> {
    protected client: LLM;
    private tools: Record<AgentMode, T[]> = {agent: [], chat: []};
    protected gw: LLMGWConfig;

    constructor(isSubLoop: boolean, llmConfig: LLMConfig) {
        this.gw = {
            model: llmConfig.model,
            timeoutMs: 300 * 1000, // JSON: seconds → client: ms
            temperature: 0.1,
            maxTokens: 8000
        }
        const allTools = ToolsManager.getToolsArray(isSubLoop);
        for (const mode of Object.keys(allTools) as AgentMode[]) {
            this.tools[mode] = this.convertTools(allTools[mode]);
        };
        this.client = this.createLLMClient(llmConfig.baseURL, llmConfig.apiKey, this.gw.timeoutMs);
    }

    public updateGWConfig(
        newClient: {baseURL: string, apiKey: string}|null,
        config: CommonKeys<LLMConfig, LLMGWConfig>
    ) {
        Object.assign(this.gw, config);
        if (newClient) {
            this.client = this.createLLMClient(newClient.baseURL, newClient.apiKey, this.gw.timeoutMs);
        }
    }

    protected abstract convertTools(tools: LLMTool[]): T[];

    protected abstract createLLMClient(baseURL: string, apiKey: string, timeout: number): LLM;

    public async invoke(
        mode: AgentMode,
        system: string,
        messages: I[],
        streamer: (text: string) => void, logger: Logger
    ): Promise<O> {
        let response: O | null = null;
        for (let i = 0; i < llmRetry; i++) {
            try {
                response = await this._invoke(system, messages, this.tools[mode], streamer);
                break;
            } catch (error) {
                logger.error(error, 'LLM invoke failed');
                if (this.isInputExceedLimit(error)) {
                    response = this.newResponse('Input token exceeds the limit.', 'inputMaxTokens');
                } else {
                    const unrecoverableError = this.isUnrecoverableError(error);
                    if (unrecoverableError) {
                        response = this.newResponse(`ERROR: Unrecoverable error: ${unrecoverableError}.`, 'error');
                        break;
                    }
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

    protected abstract _invoke(
        system: string,
        messages: I[],
        tools: T[],
        streamer: (text: string) => void
    ): Promise<O>;

    protected abstract isInputExceedLimit(error: any): boolean;

    private isUnrecoverableError(error: any): string {
        const code = error?.status;
        if (code === 400 || code === 429 || code === 403 || code === 401 || code === 404) {
            return error?.message ?? code.toString();
        }
        return '';
    }

    public async compact(
        mode: AgentMode,
        system: string,
        content: string,
        logger: Logger
    ): Promise<string> {
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
        const response = await this.invoke(
            mode,
            system,
            [this.newInputMessage(prompt)],
            () => {},
            logger
        );
        return this.getTextFromResponse(response);
    }
    
    public newInputMessage(content: string, user: boolean = true): I {
        return {role: user ? 'user' : 'assistant', content} as I;
    }

    protected abstract setTransitionReason(response: O): O;

    protected abstract newResponse(content: string, transitionReason?: TransitionReason): O;

    protected abstract convertResponseToMessages(response: O): I[];

    protected abstract getTextFromResponse(response: O): string;

    public abstract getTextFromInputMessage(message: I): string;

}
