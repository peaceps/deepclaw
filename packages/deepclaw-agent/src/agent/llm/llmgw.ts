import {AgentMode, LLMConfig} from '@deepclaw/config';
import {type Logger, type CommonKeys} from '@deepclaw/node-utils';
import { LLMTool } from '../definitions/tool-definitions';
import {
    FlushAgentRole, LLMGWConfig, LLMTransitionReason, TokenUsage, type ImageContent
} from '@deepclaw/core';
import { ToolsManager } from '../loop/services/tools-manager';
import { LoopKind, SystemPrompt, type OverflowLimit } from '../definitions/definitions';

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
 * a missed overflow costs the run, a false one costs a summary the run did not need.
 */
const CONTEXT_OVERFLOW_PHRASES = [
    'context limit',
    'context length',
    'context_length_exceeded',
    'range of input length',
    'max bytes to request body',
];

/**
 * Something oversized, said of the conversation and not of something else in the request.
 *
 * `too long` and `too large` alone would take in bad requests that have nothing to do with the
 * size of the history, and the words that could tell them apart have to be the ones next to the
 * complaint and have to name the conversation itself. Neither half of that is enough on its own.
 * Anywhere in the message is too loose because a 400 body says `request` and `message` almost
 * however it fails; those two words are too loose wherever they sit, since the oversized thing
 * usually is part of the request -- "invalid request: image too large" puts `request` four words
 * from the complaint and means nothing of the sort.
 *
 * Being wrong here is cheaper than it was: a failed summary leaves the history alone now, and what
 * the user is told after three of them is that the conversation is too long. But that sentence is
 * still the wrong thing to say about an oversized image, and it is said after two summaries the
 * run did not need.
 */
const OVERSIZE_COMPLAINT =
    /(prompt|context|conversation|history|messages|tokens?)[^.;]{0,40}too (long|large)/;

export function isContextOverflowMessage(message: unknown): boolean {
    const text = String(message ?? '').toLowerCase();
    return CONTEXT_OVERFLOW_PHRASES.some(phrase => text.includes(phrase))
        || OVERSIZE_COMPLAINT.test(text);
}

/**
 * Where in a refusal the window is written, one wording per vendor.
 *
 * A pattern each rather than a rule about numbers in general, because the vendors do not agree on
 * the order: anthropic names what was sent and then the limit, openai names the limit and then
 * what was sent. Nothing as simple as the largest or the last number reads both.
 */
const TOKEN_LIMIT_PATTERNS = [
    // DashScope, measured: "Range of input length should be [1, 983616]". The window is the second
    // number of the range, the first being the floor.
    /range of input length should be \[\s*\d+\s*,\s*(\d+)\s*\]/,
    // Anthropic: "prompt is too long: 215432 tokens > 200000 maximum".
    />\s*(\d+)\s*maximum/,
    // OpenAI: "This model's maximum context length is 128000 tokens. However, your messages
    // resulted in 130000 tokens".
    /maximum context length is\s*(\d+)/,
];

const BYTE_LIMIT_PATTERNS = [
    // DashScope, measured: "Exceeded limit on max bytes to request body : 6291456".
    /max bytes to request body\s*:\s*(\d+)/,
];

/**
 * When what came back from a summarizer is not a summary.
 *
 * The text of these is a notice written by this file -- "Input token exceeds the limit.", or an
 * error -- and a caller that took it for a summary would put it in place of the conversation it
 * was meant to summarize. That is the whole conversation gone, replaced by one sentence about why
 * it could not be shortened. A refusal here is the likely one of the two: the summarizer is handed
 * the same history in a single message, so a history too long for the model is too long for the
 * call meant to shorten it.
 *
 * An output limit is not on the list. That is a summary cut off at the end, which is a shorter
 * summary and still a great deal better than the conversation it stands for.
 *
 * The list is not the whole of the test, because a call can come back untroubled with no summary in
 * it. The tools are bound to this call as they are to any other, so a model handed a conversation
 * made largely of tool traces may answer it with a tool call of its own and nothing else -- that is
 * `toolUse`, which is on nobody's list of failures, and no text at all. Empty is the worse of the
 * two failures to ship, a template with nothing under "Summary of prior context" reading as a
 * conversation that happened and left no trace rather than as something having gone wrong.
 */
const UNUSABLE_SUMMARY_REASONS: LLMTransitionReason[] = ['inputMaxTokens', 'error', 'refused'];

function firstMatch(text: string, patterns: RegExp[]): number | undefined {
    for (const pattern of patterns) {
        const found = pattern.exec(text);
        const value = found?.[1] ? Number(found[1]) : NaN;
        if (Number.isFinite(value) && value > 0) {
            return value;
        }
    }
    return undefined;
}

export function readOverflowLimit(message: unknown): OverflowLimit {
    const text = String(message ?? '').toLowerCase();
    const limit: OverflowLimit = {};
    const tokens = firstMatch(text, TOKEN_LIMIT_PATTERNS);
    const bytes = firstMatch(text, BYTE_LIMIT_PATTERNS);
    if (tokens !== undefined) {
        limit.tokens = tokens;
    }
    if (bytes !== undefined) {
        limit.bytes = bytes;
    }
    return limit;
}

/**
 * Everything a refusal said, from both of the places a refusal says it.
 *
 * Both are read rather than the first that is there. The sdks put the whole body on the top-level
 * message today, so the nested one is usually a repeat, but "usually" is the wrong thing to build
 * on: taking the first present one means a top-level message that exists and says nothing about
 * size hides a nested one that names the limit exactly, and nothing about that failure is visible
 * -- the overflow reads as an ordinary bad request and the run ends.
 */
export function wordsOfError(error: any): string {
    return [error?.message, error?.error?.message]
        .filter(words => typeof words === 'string' && words.length > 0)
        .join('\n');
}

export type LLMConstructor<I, O extends {transitionReason: LLMTransitionReason}, T, LLM> =
    new (loopKind: LoopKind, role: FlushAgentRole, llmConfig: LLMConfig) => LLMModel<I, O, T, LLM>;

export abstract class LLMModel<I, O extends {transitionReason: LLMTransitionReason}, T, LLM> {
    protected client: LLM;
    private loopKind: LoopKind;
    /** Fixed for as long as this model lives, the same as the kind of loop it belongs to. */
    private role: FlushAgentRole;
    protected gw: LLMGWConfig;
    /**
     * What the last refusal said the limit was, until whoever records it has taken it.
     *
     * Kept here rather than put on the response because the response is the vendor's own shape,
     * one per protocol, and this belongs to none of them. Taken rather than read, so that a
     * refusal is recorded once: the turn that reads it is the turn it happened in.
     */
    private observedLimit: OverflowLimit | undefined;

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

    /** The limit the last refusal named, and it is gone from here once taken. */
    public takeObservedLimit(): OverflowLimit | undefined {
        const limit = this.observedLimit;
        this.observedLimit = undefined;
        return limit;
    }

    public modelName(): string {
        return this.gw.model;
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
                    this.observedLimit = readOverflowLimit(wordsOfError(error));
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
    ): Promise<{summary: string, tokenUsage: TokenUsage, usable: boolean}> {
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
        // Taken here and dropped, so that a refusal of this call cannot be read as a refusal of
        // the conversation. The two go through the same invoke and leave the observation in the
        // same place, but only the main loop ever collects it, and a summarizer refusal left
        // sitting there would be picked up by the next main call that succeeded -- turning a call
        // that went through into a call that was refused, which skips the evidence it carried and
        // leaves the token side reading a size that is no longer the history's. The limit itself
        // is no loss: a summary that failed leaves the conversation as long as it was, so the
        // refusal is about to arrive again on the main path, where it belongs to somebody.
        this.takeObservedLimit();
        const summary = this.getTextFromResponse(response);
        return {
            summary,
            tokenUsage: this.getTokenUsage(response),
            usable: !UNUSABLE_SUMMARY_REASONS.includes(response.transitionReason)
                && summary.trim().length > 0,
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
