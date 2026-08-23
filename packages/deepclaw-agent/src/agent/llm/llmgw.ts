import {AgentMode, LLMConfig} from '@deepclaw/config';
import {type Logger, type CommonKeys} from '@deepclaw/node-utils';
import { LLMTool } from '../definitions/tool-definitions';
import {
    FlushAgentRole, LLMGWConfig, LLMTransitionReason, TokenUsage, type ImageContent
} from '@deepclaw/core';
import { ToolsManager } from '../loop/services/tools-manager';
import { LoopKind, SystemPrompt } from '../definitions/definitions';

const llmRetry = 3;

export type LLMConstructor<I, O extends {transitionReason: LLMTransitionReason}, T, LLM> =
    new (loopKind: LoopKind, role: FlushAgentRole, llmConfig: LLMConfig) => LLMModel<I, O, T, LLM>;

export abstract class LLMModel<I, O extends {transitionReason: LLMTransitionReason}, T, LLM> {
    protected client: LLM;
    private loopKind: LoopKind;
    /** Fixed for as long as this model lives, the same as the kind of loop it belongs to. */
    private role: FlushAgentRole;
    protected gw: LLMGWConfig;

    constructor(loopKind: LoopKind, role: FlushAgentRole, llmConfig: LLMConfig) {
        this.gw = {
            model: llmConfig.model,
            timeoutMs: 300 * 1000,
            temperature: 0.1,
            maxTokens: 8000
        }
        this.loopKind = loopKind;
        this.role = role;
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
        system: SystemPrompt,
        messages: I[],
        streamer: (text: string) => void, logger: Logger
    ): Promise<O> {
        let response: O | null = null;
        const tools = this.convertTools(
            ToolsManager.getToolsArray({loopKind: this.loopKind, role: this.role, mode})
        );
        const outgoing = this.resolveImages(messages);
        for (let i = 0; i < llmRetry; i++) {
            try {
                response = await this._invoke(system, outgoing, tools, streamer);
                break;
            } catch (error) {
                logger.error(error, 'LLM invoke failed');
                if (this.isInputExceedLimit(error)) {
                    response = this.newResponse('Input token exceeds the limit.', 'inputMaxTokens');
                    break;
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
        if (response.transitionReason !== 'inputMaxTokens') {
            messages.push(...this.convertResponseToMessages(response));
        }
        return response;
    }

    protected abstract _invoke(
        system: SystemPrompt,
        messages: I[],
        tools: T[],
        streamer: (text: string) => void
    ): Promise<O>;

    /**
     * Turns the image references the history keeps into payloads the model accepts.
     * The result is what goes over the wire; the history itself keeps the references.
     * Answers with the very array it was given when there is nothing to resolve, so
     * an implementation that adjusts the live history keeps reaching it.
     */
    protected resolveImages(messages: I[]): I[] {
        return messages;
    }

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
        system: SystemPrompt,
        content: string,
        logger: Logger
    ): Promise<{summary: string, tokenUsage: TokenUsage}> {
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
        return {
            summary: this.getTextFromResponse(response),
            tokenUsage: this.getTokenUsage(response)
        };
    }
    
    public newInputMessage(content: string, user: boolean = true): I {
        return {role: user ? 'user' : 'assistant', content} as I;
    }

    public abstract newImageInputMessage(content: string, images: ImageContent[]): I;

    protected abstract setTransitionReason(response: O): O;

    protected abstract newResponse(content: string, transitionReason?: LLMTransitionReason): O;

    protected abstract convertResponseToMessages(response: O): I[];

    protected abstract getTextFromResponse(response: O): string;

    public abstract getTextFromInputMessage(message: I): string;

    public abstract getTokenUsage(response: O): TokenUsage;

}
