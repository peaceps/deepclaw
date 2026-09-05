import {AgentMode, LLMConfig} from '@deepclaw/config';
import {type Logger, type CommonKeys} from '@deepclaw/node-utils';
import { LLMTool } from '../definitions/tool-definitions';
import {
    FlushAgentRole, LLMGWConfig, LLMTransitionReason, TokenUsage, type ImageContent
} from '@deepclaw/core';
import { ToolsManager } from '../loop/services/tools-manager';
import { LoopKind, SystemPrompt, type OverflowLimit } from '../definitions/definitions';

/**
 * How many times a call is asked for before the run is told it failed. Every attempt is made from
 * here and none from inside the vendor client, which is set to retry nothing: a client that retries
 * on its own does it under the same await, so a call that stalls costs the timeout once per silent
 * attempt and the log of the run says only that the turn took a quarter of an hour. Made here, each
 * attempt is a line in the log and the arithmetic is `llmRetry` timeouts and no more.
 */
const llmRetry = 3;

/**
 * How long to wait before asking again when the refusal named no wait of its own. Long enough for
 * a hiccup at the far end to be over, short enough that three of them are not a pause anybody sits
 * through.
 */
const RETRY_WAIT_MS = 500;

/**
 * The longest wait a refusal may ask of us. A gateway turning a call away for rate has been known
 * to ask for a minute or more, and sitting out three of those in silence spends the whole patience
 * of the run on one call. Capped, the attempts run out sooner and what reaches the user is the rate
 * limit itself, which is the thing they can do something about.
 */
const MAX_RETRY_WAIT_MS = 10 * 1000;

/**
 * How long a call may go unanswered before it is given up on and made again.
 *
 * What both sdks count under this is the wait for the response to begin -- the timer is cleared the
 * moment the headers land, and the stream that follows may run as long as the model has something
 * to say -- so a minute and a half is a minute and a half of silence, not a cap on the answer. Long
 * enough that a model thinking before it speaks is not cut off, short enough that a call the far end
 * has quietly dropped is asked again while the user is still sitting there.
 *
 * A far end that answers and then goes quiet mid-stream is not this timer's business, and node holds
 * that one open for five minutes of its own.
 */
const RESPONSE_WAIT_MS = 90 * 1000;

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

/**
 * The wait a refusal asked for before the next ask, and nothing where it asked for none.
 *
 * Read out of the header the far end sends it in, which the sdks hand along as a map in one version
 * and a plain object in another, so both are looked in. A wait written as a date rather than as
 * seconds -- the other form the header allows, and one nothing here has met -- reads as nothing and
 * falls to the ordinary wait, which is the direction to be wrong in: asking again too early costs
 * one refusal, and reading a date as a number of seconds would sit out a year.
 */
export function retryAfterMs(error: any): number | undefined {
    const headers = error?.headers;
    const header = (name: string): unknown =>
        typeof headers?.get === 'function' ? headers.get(name) : headers?.[name];
    const asked = (said: unknown, unit: number): number | undefined => {
        const named = Number(said);
        return Number.isFinite(named) && named > 0
            ? Math.min(named * unit, MAX_RETRY_WAIT_MS) : undefined;
    };
    // Milliseconds first, which is the order both sdks read them in and the order of exactness:
    // openai answers a rate limit with both, and the one in seconds is that one rounded up.
    return asked(header('retry-after-ms'), 1) ?? asked(header('retry-after'), 1000);
}

/**
 * Waits, and wakes on a stop.
 *
 * The wait between attempts was half a second once, short enough that a stop landing in it was
 * noticed by the attempt that came next and refused itself. A refusal naming a wait of its own can
 * ask for seconds, and a user who pressed stop is owed none of them: what they watch in the
 * meantime is a run that has been told to stop and has not.
 */
function waitOrStop(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
        return Promise.resolve();
    }
    return new Promise(resolve => {
        const wake = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', wake);
            resolve();
        };
        const timer = setTimeout(wake, ms);
        signal?.addEventListener('abort', wake, {once: true});
    });
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

    /**
     * No sampling parameters are set here, temperature among them. A gateway serves models that
     * each accept a different set of them, and one that does not take the parameter refuses the
     * whole request over it rather than ignoring it -- which takes down the compaction too, the
     * one call that has to get through when a run is already in trouble. The default the gateway
     * picks for a model is a default that model accepts.
     */
    constructor(loopKind: LoopKind, role: FlushAgentRole, llmConfig: LLMConfig) {
        this.gw = {
            model: llmConfig.model,
            timeoutMs: RESPONSE_WAIT_MS,
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
        let lastError: unknown;
        for (let i = 0; i < llmRetry; i++) {
            try {
                response = await this._invoke(system, outgoing, tools, streamer, signal);
                break;
            } catch (error) {
                lastError = error;
                // A stopped run has not failed at anything, and every retry of it is refused by
                // the same signal: three of them, with waits that a stop wakes, put next to nothing
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
                await waitOrStop(retryAfterMs(error) ?? RETRY_WAIT_MS, signal);
                // Asked again after the wait, because the wait is where a stop most likely lands:
                // the longest one here is ten seconds, and the attempt this would otherwise go on
                // to make is a request sent on behalf of a run that is already over.
                if (signal?.aborted) {
                    throw error;
                }
            }
        }
        if (!response) {
            // What the last of them said goes along. A call that ran out of attempts was turned
            // away for a reason the user can usually act on -- the rate they are asking at, a
            // gateway that is down -- and a run told only that three tries failed hands them a
            // sentence to go looking with instead of the answer they were given three times.
            const said = wordsOfError(lastError);
            response = this.newResponse(
                `ERROR: LLM invoke failed after ${llmRetry} retries.${said ? ` ${said}` : ''}`, 'error'
            );
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

    /**
     * A refusal there is no point asking again after: the request itself is wrong, or we are not
     * who the far end lets in. Asking again changes none of them.
     *
     * Rate is not among them, though it was while the vendor client did its own retrying: what it
     * absorbed quietly, three times over, now has to be absorbed here or a run dies on a limit that
     * would have been gone a second later. It is asked again like any other, and after the wait the
     * refusal itself named where it named one.
     */
    private isUnrecoverableError(error: any): string {
        const code = error?.status;
        if (code === 400 || code === 403 || code === 401 || code === 404) {
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
