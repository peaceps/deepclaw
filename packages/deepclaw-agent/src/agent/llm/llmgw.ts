import {AgentMode, LLMConfig} from '@deepclaw/config';
import {type Logger, type CommonKeys} from '@deepclaw/node-utils';
import { LLMTool } from '../definitions/tool-definitions';
import {
    FlushAgentRole, LLMGWConfig, LLMTransitionReason, TokenUsage, type ImageContent
} from '@deepclaw/core';
import { ToolsManager } from '../loop/services/tools-manager';
import { LoopKind, SystemPrompt } from '../definitions/definitions';

const llmRetry = 3;

/**
 * What a refusal says when what it refused was the size of the conversation.
 *
 * Read off the words rather than the code beside them, because the code is the part that does not
 * travel. A gateway standing in for one of these apis answers in its own vocabulary -- DashScope
 * calls the window a range and hands back `invalid_parameter_error`, the same code it gives a
 * malformed tool -- so a check keyed to the code passes the overflow through as an ordinary bad
 * request, and the run dies where it could have compacted and gone on.
 *
 * The bytes of the body belong in the same list as the tokens of the window. A history too big to
 * send is one to compact whichever of the two the far end happened to count, and the answer to
 * both is the same summary.
 *
 * Words are matched, so the list is only as good as the wordings it has met. Anything not in it
 * falls through to the error path this always had, which is the safe direction to be wrong in:
 * a missed overflow costs the run, a false one costs three turns of compacting before the same
 * error arrives anyway.
 */
const CONTEXT_OVERFLOW_PHRASES = [
    'too long',
    'too large',
    'context limit',
    'context length',
    'context_length_exceeded',
    'range of input length',
    'max bytes to request body',
];

export function isContextOverflowMessage(message: unknown): boolean {
    const text = String(message ?? '').toLowerCase();
    return CONTEXT_OVERFLOW_PHRASES.some(phrase => text.includes(phrase));
}

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
        streamer: (text: string) => void, logger: Logger,
        signal?: AbortSignal
    ): Promise<O> {
        let response: O | null = null;
        const tools = this.convertTools(
            ToolsManager.getToolsArray({loopKind: this.loopKind, role: this.role, mode})
        );
        const outgoing = this.resolveImages(messages);
        for (let i = 0; i < llmRetry; i++) {
            try {
                response = await this._invoke(system, outgoing, tools, streamer, signal);
                break;
            } catch (error) {
                // A stopped run has not failed at anything, and every retry of it is refused by
                // the same signal: three of them with a sleep in between would only put a second
                // between the user pressing stop and the run noticing. It leaves as it came, so
                // that the loop can tell a stop apart from a call that really went wrong: a
                // response handed back here reads as an answer the model gave.
                if (signal?.aborted) {
                    throw error;
                }
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
        streamer: (text: string) => void,
        signal?: AbortSignal
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
        logger: Logger,
        signal?: AbortSignal
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
            logger,
            signal
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
