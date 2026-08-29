import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {LLMTransitionReason, TokenUsage} from '@deepclaw/core';
import type {LLMModel} from '../../llm/llmgw';
import type {FootPrint, OneLoopContext} from '../../definitions/definitions';
import {newTestContext} from '../../../test-support/one-loop-context';
import {HookManager} from '../services/hook-manager';
import {
    AbstractMessagesCompactor, MAX_RECENT_TOOL_RESULT_COUNT
} from './abstract-messages-compactor';
import {MAX_REQUEST_BYTES, UNLEARNED_TOKEN_BUDGET} from '../services/llm-window-service';
import {TRUNCATE_THRESHOLD, estimateTokens} from '../../loop-utils';

const COMPACTED = '<tool result compacted> Earlier tool result compacted. Re-run the tool if you need full detail.</tool result compacted>';

const mocks = vi.hoisted(() => ({
    wrapTimestamp: vi.fn((file: string) => `stamped-${file}`),
    writeFile: vi.fn<(path: string, content?: string | Buffer) => string>(path => path),
    enforceFileCountLimit: vi.fn<(folder: string, limit: number) => void>(() => undefined),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {
        wrapTimestamp: mocks.wrapTimestamp,
        writeFile: mocks.writeFile,
        enforceFileCountLimit: mocks.enforceFileCountLimit,
    },
}));

const emitVisitor = vi.spyOn(HookManager, 'emitVisitor');

type FakeMessage = {role: string; content: string};
type FakeResponse = {transitionReason: LLMTransitionReason};
type FakeLLM = LLMModel<FakeMessage, FakeResponse, unknown, unknown>;

/** The simplest possible protocol: a tool result is a message whose role says so. */
class TestCompactor extends AbstractMessagesCompactor<FakeMessage, FakeResponse, FakeMessage, FakeLLM> {

    protected override getToolResults(messages: FakeMessage[]): FakeMessage[] {
        return messages.filter(message => message.role === 'tool');
    }

    protected override getContentLength(toolResult: FakeMessage): number {
        return toolResult.content.length;
    }

    protected override compactToolResult(toolResult: FakeMessage, msg: string): void {
        toolResult.content = msg;
    }
}

/** A run whose goal is at one end, whose next step is at the other, and whose middle is bulk. */
function longHistory(): FakeMessage[] {
    return [
        {role: 'user', content: 'the goal, said once and never again: never use the network'},
        {role: 'assistant', content: 'x'.repeat(4000)},
        {role: 'assistant', content: 'x'.repeat(4000)},
        {role: 'assistant', content: 'the step to take next'},
    ];
}

function newToolResults(count: number, length: number = 5000): FakeMessage[] {
    return [...Array(count).keys()].map(index => ({role: 'tool', content: `${index}`.padEnd(length, 'x')}));
}

type CompactCall = (
    mode: string, system: unknown, content: string, logger: unknown, signal?: AbortSignal
) => Promise<{summary: string; tokenUsage: TokenUsage; usable: boolean}>;

function newFakeLLM(summary: string = 'the summary', tokenUsage: TokenUsage = {
    cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3
}) {
    const compact = vi.fn<CompactCall>(async () => ({summary, tokenUsage, usable: true}));
    const newInputMessage = vi.fn((content: string): FakeMessage => ({role: 'user', content}));
    return {llm: {compact, newInputMessage} as unknown as FakeLLM, compact, newInputMessage};
}

function messageOfSize(size: number): FakeMessage {
    const overhead = JSON.stringify({role: 'assistant', content: ''}).length;
    return {role: 'assistant', content: 'x'.repeat(size - overhead)};
}

function newContext(overrides: Partial<OneLoopContext> = {}): OneLoopContext {
    return newTestContext(overrides);
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.wrapTimestamp.mockImplementation((file: string) => `stamped-${file}`);
    emitVisitor.mockResolvedValue(undefined);
});

describe('AbstractMessagesCompactor compactOldResults', () => {

    test('does nothing for an empty history', () => {
        new TestCompactor().compactOldResults([], newContext());
        expect(emitVisitor).not.toHaveBeenCalled();
    });

    test('keeps every result while there are no more of them than the recent window holds', () => {
        const messages = newToolResults(MAX_RECENT_TOOL_RESULT_COUNT);
        new TestCompactor().compactOldResults(messages, newContext());
        expect(messages.some(message => message.content === COMPACTED)).toBe(false);
    });

    test('compacts the results that fall out of the recent window', () => {
        const messages = newToolResults(MAX_RECENT_TOOL_RESULT_COUNT + 2);
        new TestCompactor().compactOldResults(messages, newContext());
        expect(messages[0]!.content).toBe(COMPACTED);
        expect(messages[1]!.content).toBe(COMPACTED);
        expect(messages[2]!.content).not.toBe(COMPACTED);
        expect(messages.at(-1)!.content).not.toBe(COMPACTED);
    });

    test('keeps an old result that is exactly at the size threshold', () => {
        const messages = newToolResults(MAX_RECENT_TOOL_RESULT_COUNT + 1);
        messages[0] = {role: 'tool', content: 'x'.repeat(1200)};
        new TestCompactor().compactOldResults(messages, newContext());
        expect(messages[0]!.content).toHaveLength(1200);
        expect(emitVisitor).not.toHaveBeenCalled();
    });

    test('compacts an old result that is one character over the threshold', () => {
        const messages = newToolResults(MAX_RECENT_TOOL_RESULT_COUNT + 1);
        messages[0] = {role: 'tool', content: 'x'.repeat(1201)};
        new TestCompactor().compactOldResults(messages, newContext());
        expect(messages[0]!.content).toBe(COMPACTED);
    });

    test('reports the original length of every compacted result to the hooks', () => {
        const messages = newToolResults(MAX_RECENT_TOOL_RESULT_COUNT + 1, 3000);
        const context = newContext();
        new TestCompactor().compactOldResults(messages, context);
        expect(emitVisitor).toHaveBeenCalledExactlyOnceWith('toolResultCompacted', context, 3000);
    });

    test('only counts the tool results when deciding what is recent', () => {
        const messages: FakeMessage[] = [
            {role: 'user', content: 'x'.repeat(5000)},
            ...newToolResults(MAX_RECENT_TOOL_RESULT_COUNT),
            {role: 'assistant', content: 'x'.repeat(5000)},
        ];
        new TestCompactor().compactOldResults(messages, newContext());
        expect(messages.some(message => message.content === COMPACTED)).toBe(false);
    });

    test('leaves a window that cannot by itself outgrow what triggers the full compaction', () => {
        // Characters against a budget of tokens, compared at the worst rate the two meet at: one
        // character to one token, which is chinese. Anything else has room to spare.
        expect(MAX_RECENT_TOOL_RESULT_COUNT * TRUNCATE_THRESHOLD)
            .toBeLessThan(UNLEARNED_TOKEN_BUDGET);
    });
});

describe('AbstractMessagesCompactor compactFullHistory', () => {

    test('does nothing when the history is empty', async () => {
        const {llm, compact} = newFakeLLM();
        const messages: FakeMessage[] = [];
        await new TestCompactor().compactFullHistory(true, newContext(), [], llm, messages);
        expect(compact).not.toHaveBeenCalled();
        expect(mocks.writeFile).not.toHaveBeenCalled();
        expect(messages).toEqual([]);
    });

    test('does nothing for a small history that is still current', async () => {
        const {llm, compact} = newFakeLLM();
        const messages: FakeMessage[] = [{role: 'user', content: 'hi'}, {role: 'assistant', content: 'hello'}];
        await new TestCompactor().compactFullHistory(false, newContext(), [], llm, messages);
        expect(compact).not.toHaveBeenCalled();
        expect(messages).toHaveLength(2);
    });

    test('replaces an outdated history with the summary message', async () => {
        const {llm} = newFakeLLM();
        const messages: FakeMessage[] = [{role: 'user', content: 'hi'}, {role: 'assistant', content: 'hello'}];
        await new TestCompactor().compactFullHistory(true, newContext(), [], llm, messages);
        expect(messages).toHaveLength(1);
        expect(messages[0]!.content).toContain('the summary');
    });

    test('keeps the history when what came back was not a summary', async () => {
        // The summarizer is refused over the same history it was called to shorten, and its notice
        // taken for a summary would be the whole conversation replaced by one sentence about why
        // it could not be shortened. The caller is refused again and gives up saying so, which
        // loses the run and keeps the conversation.
        const {llm, compact} = newFakeLLM();
        compact.mockResolvedValue({
            summary: 'Input token exceeds the limit.',
            tokenUsage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
            usable: false,
        });
        const messages: FakeMessage[] = [{role: 'user', content: 'hi'}, {role: 'assistant', content: 'hello'}];
        await new TestCompactor().compactFullHistory(true, newContext(), [], llm, messages);
        expect(messages).toEqual([{role: 'user', content: 'hi'}, {role: 'assistant', content: 'hello'}]);
    });

    /**
     * What the caller migrating a session between protocols goes on. The summary is the whole of
     * the conversion, so a history that kept its messages kept the shape of the model before it,
     * and a caller told otherwise marks a migration that never happened -- which is the one mark
     * that stops anything from ever trying again.
     */
    test('reports the history it left in place as not converted', async () => {
        const {llm, compact} = newFakeLLM();
        compact.mockResolvedValue({
            summary: 'Input token exceeds the limit.',
            tokenUsage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
            usable: false,
        });
        const converted = await new TestCompactor().compactFullHistory(
            true, newContext(), [], llm, [{role: 'user', content: 'hi'}, {role: 'assistant', content: 'hello'}]
        );
        expect(converted).toBe(false);
    });

    test('reports a history it replaced with a summary as converted', async () => {
        const {llm} = newFakeLLM();
        const converted = await new TestCompactor().compactFullHistory(
            true, newContext(), [], llm, [{role: 'user', content: 'hi'}, {role: 'assistant', content: 'hello'}]
        );
        expect(converted).toBe(true);
    });

    /**
     * Nothing to summarize is not a failure to summarize. An empty history is in no protocol at
     * all and no further call would put it in one, so a caller that waits for a conversion here
     * waits for good: the session stays marked outdated and every run after it opens by trying the
     * migration again.
     */
    test('reports an empty history as converted, there being nothing to convert', async () => {
        const {llm} = newFakeLLM();
        const converted = await new TestCompactor().compactFullHistory(true, newContext(), [], llm, []);
        expect(converted).toBe(true);
    });

    test('tells the hooks of no compaction that did not happen', async () => {
        const {llm, compact} = newFakeLLM();
        compact.mockResolvedValue({
            summary: 'Input token exceeds the limit.',
            tokenUsage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
            usable: false,
        });
        await new TestCompactor().compactFullHistory(
            true, newContext(), [], llm, [{role: 'assistant', content: 'hello'}]
        );
        expect(emitVisitor).not.toHaveBeenCalled();
    });

    test('archives nothing when the history is staying where it is', async () => {
        // The archive is the one copy of what a summary replaced. A compaction that failed
        // replaced nothing, and the session writes that same history out at the end of the turn,
        // so a copy here would be idle -- and not merely idle at five archives kept, the run that
        // gives up trying this three times and pushing out the archives of real compactions.
        const {llm, compact} = newFakeLLM();
        compact.mockResolvedValue({
            summary: 'Input token exceeds the limit.',
            tokenUsage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
            usable: false,
        });
        await new TestCompactor().compactFullHistory(
            true, newContext(), [], llm, [{role: 'assistant', content: 'hello'}]
        );
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    test('sends the whole history to the summarizer while it fits', async () => {
        const {llm, compact} = newFakeLLM();
        const messages: FakeMessage[] = [{role: 'user', content: 'hi'}, {role: 'assistant', content: 'hello'}];
        await new TestCompactor().compactFullHistory(true, newContext(), [], llm, messages);
        expect(compact.mock.calls[0]![2])
            .toBe('{"role":"user","content":"hi"}\n{"role":"assistant","content":"hello"}');
    });

    test('sends both ends of a history too long to summarize whole', async () => {
        // The moment a window is finally learned is the moment the history is at its widest, so the
        // compaction that follows that refusal is the one most likely to be refused in turn -- and
        // it sends the conversation whole in a single message. Trimming here is what keeps the run
        // alive at the one point it finds out how wide the window is.
        const {llm, compact} = newFakeLLM();
        await new TestCompactor().compactFullHistory(
            true, newContext(), [], llm, longHistory(), {tokens: 400, bytes: MAX_REQUEST_BYTES}
        );
        const sent = compact.mock.calls[0]![2];
        expect(sent).toContain('the goal, said once and never again');
        expect(sent).toContain('the step to take next');
        expect(sent).not.toContain('x'.repeat(4000));
        expect(estimateTokens(sent)).toBeLessThan(500);
    });

    test('keeps the opening, which is where the goal and the constraints are stated', async () => {
        // The summarizer is asked for the goal of the run and the constraints of the user. Both are
        // said once, at the start, and an agent that loses them has nothing left to aim at -- and
        // the summary is all that survives a compaction, so the opening is not merely out of sight.
        const {llm, compact} = newFakeLLM();
        await new TestCompactor().compactFullHistory(
            true, newContext(), [], llm, longHistory(), {tokens: 400, bytes: MAX_REQUEST_BYTES}
        );
        expect(compact.mock.calls[0]![2]).toContain('never use the network');
    });

    test('says how much was left out, so a part is not read as the whole', async () => {
        const {llm, compact} = newFakeLLM();
        await new TestCompactor().compactFullHistory(
            true, newContext(), [], llm, longHistory(), {tokens: 400, bytes: MAX_REQUEST_BYTES}
        );
        expect(compact.mock.calls[0]![2]).toContain('2 earlier messages omitted');
    });

    test('archives the history whole even where only its ends were summarized', async () => {
        const {llm} = newFakeLLM();
        await new TestCompactor().compactFullHistory(
            true, newContext(), [], llm, longHistory(), {tokens: 400, bytes: MAX_REQUEST_BYTES}
        );
        expect(mocks.writeFile.mock.calls[0]![1]).toContain('x'.repeat(4000));
    });

    test('spends what a short opening left over on the end', async () => {
        const {llm, compact} = newFakeLLM();
        const messages: FakeMessage[] = [
            {role: 'user', content: 'go'},
            {role: 'assistant', content: 'x'.repeat(4000)},
            {role: 'assistant', content: 'z'.repeat(1000)},
        ];
        await new TestCompactor().compactFullHistory(
            true, newContext(), [], llm, messages, {tokens: 400, bytes: MAX_REQUEST_BYTES}
        );
        // A quarter of the budget would not hold the thousand z's; what the two-token opening did
        // not spend does.
        expect(compact.mock.calls[0]![2]).toContain('z'.repeat(1000));
    });

    test('trims against the byte wall too, a gateway having named one', async () => {
        // A refusal over the bytes of a request named nothing about tokens, so trimming by tokens
        // alone would send the summarizer exactly the byte count that was just refused, and the
        // compaction meant to rescue the run would be refused for the reason the run was.
        const {llm, compact} = newFakeLLM();
        await new TestCompactor().compactFullHistory(
            true, newContext(), [], llm, longHistory(), {tokens: 150000, bytes: 2000}
        );
        const sent = compact.mock.calls[0]![2];
        expect(Buffer.byteLength(sent, 'utf8')).toBeLessThan(2000);
        expect(sent).toContain('the step to take next');
    });

    test('keeps one message whatever it measures, an empty call being a refusal for nothing', async () => {
        const {llm, compact} = newFakeLLM();
        const messages: FakeMessage[] = [{role: 'assistant', content: 'y'.repeat(4000)}];
        await new TestCompactor().compactFullHistory(
            true, newContext(), [], llm, messages, {tokens: 10, bytes: MAX_REQUEST_BYTES}
        );
        expect(compact.mock.calls[0]![2]).toContain('y'.repeat(4000));
    });

    test('keeps the history when the summary came back empty', async () => {
        // The tools are bound to the summarizer call as to any other, so a conversation made of
        // tool traces can be answered with a tool call and no text. Nothing said it failed, and
        // the template would have gone in with nothing under it.
        const {llm, compact} = newFakeLLM();
        compact.mockResolvedValue({
            summary: '   ',
            tokenUsage: {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 0},
            usable: false,
        });
        const messages: FakeMessage[] = [{role: 'user', content: 'hi'}, {role: 'assistant', content: 'hello'}];
        await new TestCompactor().compactFullHistory(true, newContext(), [], llm, messages);
        expect(messages).toEqual([{role: 'user', content: 'hi'}, {role: 'assistant', content: 'hello'}]);
    });

    test('keeps a trailing user message after the summary and out of the summarized text', async () => {
        const {llm, compact} = newFakeLLM();
        const messages: FakeMessage[] = [{role: 'assistant', content: 'hello'}, {role: 'user', content: 'now do this'}];
        await new TestCompactor().compactFullHistory(true, newContext(), [], llm, messages);
        expect(messages).toHaveLength(2);
        expect(messages[1]).toEqual({role: 'user', content: 'now do this'});
        expect(compact.mock.calls[0]![2]).toBe('{"role":"assistant","content":"hello"}');
    });

    test('does not compact when the only message is the trailing user message', async () => {
        const {llm, compact} = newFakeLLM();
        const messages: FakeMessage[] = [{role: 'user', content: 'the first thing i say'}];
        await new TestCompactor().compactFullHistory(true, newContext(), [], llm, messages);
        expect(compact).not.toHaveBeenCalled();
        expect(messages).toEqual([{role: 'user', content: 'the first thing i say'}]);
    });

    test('keeps a current history whose json is exactly at the byte backstop', async () => {
        const {llm, compact} = newFakeLLM();
        const messages: FakeMessage[] = [messageOfSize(MAX_REQUEST_BYTES)];
        await new TestCompactor().compactFullHistory(false, newContext(), [], llm, messages);
        expect(compact).not.toHaveBeenCalled();
    });

    test('compacts a current history one byte over the backstop', async () => {
        const {llm, compact} = newFakeLLM();
        const messages: FakeMessage[] = [messageOfSize(MAX_REQUEST_BYTES + 1)];
        await new TestCompactor().compactFullHistory(false, newContext(), [], llm, messages);
        expect(compact).toHaveBeenCalledOnce();
        expect(messages).toHaveLength(1);
    });

    test('weighs the history against the byte budget the caller supplies', async () => {
        // A gateway that has said where its own wall is replaces the backstop with the
        // measurement, whichever way that goes.
        const {llm, compact} = newFakeLLM();
        const messages: FakeMessage[] = [messageOfSize(2000)];
        await new TestCompactor().compactFullHistory(
            false, newContext(), [], llm, messages, {tokens: 150000, bytes: 1000}
        );
        expect(compact).toHaveBeenCalledOnce();
    });

    test('leaves the token side of the budget to the caller', async () => {
        // Asked here it would be asked of the history as it stands, and a gate that binds the
        // history every turn is a gate no request ever gets past -- which is no request ever
        // proving the window wider than the gate.
        const {llm, compact} = newFakeLLM();
        const messages: FakeMessage[] = [messageOfSize(20000)];
        await new TestCompactor().compactFullHistory(
            false, newContext(), [], llm, messages, {tokens: 10, bytes: MAX_REQUEST_BYTES}
        );
        expect(compact).not.toHaveBeenCalled();
    });

    test('weighs the history in bytes, not in characters', async () => {
        // `JSON.stringify` leaves non-ascii text as it found it, so a character of chinese is one
        // character of the jsonl and three bytes on the wire. Measured as characters a wall of six
        // megabytes would be a wall of eighteen, and the gateway that named it would refuse a
        // request this had just let through.
        const {llm, compact} = newFakeLLM();
        const chinese: FakeMessage = {role: 'assistant', content: '中'.repeat(500)};
        expect(JSON.stringify(chinese).length).toBeLessThan(1000);
        await new TestCompactor().compactFullHistory(
            false, newContext(), [], llm, [chinese], {tokens: 150000, bytes: 1000}
        );
        expect(compact).toHaveBeenCalledOnce();
    });

    test('falls back to the backstop when the caller names no budget', async () => {
        const {llm, compact} = newFakeLLM();
        const messages: FakeMessage[] = [messageOfSize(MAX_REQUEST_BYTES + 1)];
        await new TestCompactor().compactFullHistory(false, newContext(), [], llm, messages);
        expect(compact).toHaveBeenCalledOnce();
    });

    test('joins the messages as one json line per message', async () => {
        const {llm, compact} = newFakeLLM();
        const messages: FakeMessage[] = [{role: 'user', content: 'hi'}, {role: 'assistant', content: 'hello'}];
        await new TestCompactor().compactFullHistory(true, newContext(), [], llm, messages);
        expect(compact.mock.calls[0]![2])
            .toBe('{"role":"user","content":"hi"}\n{"role":"assistant","content":"hello"}');
    });

    test('saves the raw history to a timestamped file and trims the folder', async () => {
        const {llm} = newFakeLLM();
        const context = newContext({sessionDir: '.agents/a1/session/s9'});
        await new TestCompactor().compactFullHistory(true, context, [], llm, [{role: 'user', content: 'hi'}, {role: 'assistant', content: 'bye'}]);
        expect(mocks.wrapTimestamp).toHaveBeenCalledExactlyOnceWith('history_compact.jsonl');
        expect(mocks.writeFile).toHaveBeenCalledExactlyOnceWith(
            '.agents/a1/session/s9/history/stamped-history_compact.jsonl',
            '{"role":"user","content":"hi"}\n{"role":"assistant","content":"bye"}'
        );
        expect(mocks.enforceFileCountLimit)
            .toHaveBeenCalledExactlyOnceWith('.agents/a1/session/s9/history', 5);
    });

    test('summarizes with the mode, the system prompt and the logger of the loop', async () => {
        const {llm, compact} = newFakeLLM();
        const context = newContext();
        await new TestCompactor().compactFullHistory(true, context, [], llm, [{role: 'assistant', content: 'hello'}]);
        expect(compact).toHaveBeenCalledExactlyOnceWith(
            'agent', context.system, '{"role":"assistant","content":"hello"}', context.logger, undefined
        );
    });

    test('summarizes under the signal of the run, which is the slowest call there is to stop', async () => {
        const {llm, compact} = newFakeLLM();
        const abortSignal = new AbortController().signal;
        const context = newContext({abortSignal});
        await new TestCompactor().compactFullHistory(true, context, [], llm, [{role: 'assistant', content: 'hello'}]);
        expect(compact.mock.calls[0]![4]).toBe(abortSignal);
    });

    test('adds the tokens spent on the summary to the runtime usage', async () => {
        const {llm} = newFakeLLM();
        const context = newContext();
        context.runtime.usage = {cachedInputTokens: 10, noCachedInputTokens: 10, outputTokens: 10};
        await new TestCompactor().compactFullHistory(true, context, [], llm, [{role: 'assistant', content: 'hello'}]);
        expect(context.runtime.usage)
            .toEqual({cachedInputTokens: 11, noCachedInputTokens: 12, outputTokens: 13});
    });

    test('wraps the summary in a continuation prompt', async () => {
        const {llm, newInputMessage} = newFakeLLM();
        await new TestCompactor().compactFullHistory(true, newContext(), [], llm, [{role: 'assistant', content: 'hello'}]);
        const prompt = newInputMessage.mock.calls[0]![0];
        expect(prompt).toContain('This session continues from a previous conversation that was compacted.');
        expect(prompt).toContain('the summary');
        expect(prompt).toContain('Continue from where we left off without re-asking the user.');
    });

    test('lists the files the agent read', async () => {
        const {llm, newInputMessage} = newFakeLLM();
        const footPrints: FootPrint[] = [
            {type: 'read_file', content: 'src/a.ts'},
            {type: 'run_command', content: 'ls'},
            {type: 'read_file', content: 'src/b.ts'},
        ];
        await new TestCompactor().compactFullHistory(true, newContext(), footPrints, llm, [{role: 'assistant', content: 'hello'}]);
        const prompt = newInputMessage.mock.calls[0]![0];
        expect(prompt).toContain('- src/a.ts\n- src/b.ts');
        expect(prompt).toContain('you can read the full content of these files by using the read_file tool');
        expect(prompt).not.toContain('ls');
    });

    test('names a file read again and again only once', async () => {
        const {llm, newInputMessage} = newFakeLLM();
        const footPrints: FootPrint[] = [
            {type: 'read_file', content: 'src/a.ts'},
            {type: 'read_file', content: 'src/b.ts'},
            {type: 'read_file', content: 'src/a.ts'},
        ];
        await new TestCompactor().compactFullHistory(true, newContext(), footPrints, llm, [{role: 'assistant', content: 'hello'}]);
        expect(newInputMessage.mock.calls[0]![0]).toContain('- src/a.ts\n- src/b.ts\nIf needed');
    });

    /** Nothing read is nothing to say about reading, rather than a heading over an empty list. */
    test('says nothing of the files when none was read', async () => {
        const {llm, newInputMessage} = newFakeLLM();
        const footPrints: FootPrint[] = [{type: 'run_command', content: 'ls'}];
        await new TestCompactor().compactFullHistory(true, newContext(), footPrints, llm, [{role: 'assistant', content: 'hello'}]);
        const prompt = newInputMessage.mock.calls[0]![0];
        expect(prompt).not.toContain('files');
        expect(prompt).toContain('Continue from where we left off without re-asking the user.');
    });

    test('reports the compacted size to the hooks', async () => {
        const {llm} = newFakeLLM();
        const context = newContext();
        await new TestCompactor().compactFullHistory(true, context, [], llm, [{role: 'assistant', content: 'hello'}]);
        expect(emitVisitor).toHaveBeenCalledExactlyOnceWith(
            'historyCompacted', context, '{"role":"assistant","content":"hello"}'.length
        );
    });
});
