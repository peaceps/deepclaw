import {describe, test, expect, vi, beforeEach} from 'vitest';

const mocks = vi.hoisted(() => ({
    readFile: vi.fn<(path: string) => string>(),
    writeFile: vi.fn<(path: string, content: string) => void>(),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {readFile: mocks.readFile, writeFile: mocks.writeFile},
}));

const {
    LLMWindowService, WINDOW_MARGIN, UNLEARNED_TOKEN_BUDGET, MAX_REQUEST_BYTES, GROWTH_ALLOWANCE
} = await import('./llm-window-service');

/** What the service last wrote for an agent, as the object it wrote. */
function written(): Record<string, unknown> {
    return JSON.parse(mocks.writeFile.mock.calls.at(-1)![1]);
}

function storedIs(content: unknown): void {
    mocks.readFile.mockReturnValue(JSON.stringify(content));
}

beforeEach(() => {
    vi.clearAllMocks();
    LLMWindowService.clear();
    mocks.readFile.mockImplementation(() => {
        throw new Error('ENOENT');
    });
});

describe('loading what an agent learned before', () => {

    test('starts blank when nothing has ever been written', () => {
        expect(LLMWindowService.load('a1', 'qwen3')).toEqual({model: 'qwen3'});
    });

    test('reads the file back', () => {
        storedIs({model: 'qwen3', upperTokens: 983616, bodyBytes: 6291456});
        expect(LLMWindowService.load('a1', 'qwen3'))
            .toEqual({model: 'qwen3', upperTokens: 983616, bodyBytes: 6291456});
    });

    test('keeps it in memory rather than reading once a turn', () => {
        storedIs({model: 'qwen3', upperTokens: 983616});
        LLMWindowService.budgetOf('a1', 'qwen3');
        LLMWindowService.budgetOf('a1', 'qwen3');
        expect(mocks.readFile).toHaveBeenCalledTimes(1);
    });

    test('throws away what was learned of another model', () => {
        // The bounds would right themselves in time, but an upper bound off a window ten times
        // wider costs a refused call every turn until they do, and a config that has been edited
        // is not a thing to find out the hard way.
        storedIs({model: 'qwen3', upperTokens: 983616, bodyBytes: 6291456});
        expect(LLMWindowService.load('a1', 'claude-sonnet')).toEqual({model: 'claude-sonnet'});
    });

    test('starts blank on a file that no longer parses', () => {
        mocks.readFile.mockReturnValue('{ half a fi');
        expect(LLMWindowService.load('a1', 'qwen3')).toEqual({model: 'qwen3'});
    });

    test('keeps each agent apart, endpoint and all', () => {
        mocks.readFile.mockImplementation((path: string) =>
            JSON.stringify({model: 'qwen3', upperTokens: path.includes('a1') ? 983616 : 32000})
        );
        expect(LLMWindowService.budgetOf('a1', 'qwen3').tokens)
            .not.toBe(LLMWindowService.budgetOf('a2', 'qwen3').tokens);
    });
});

describe('learning from a call that went through', () => {

    test('raises the floor to what that call carried', () => {
        LLMWindowService.observeAccepted('a1', 'qwen3', 400048);
        expect(written()).toEqual({model: 'qwen3', lowerTokens: 400048});
    });

    test('does not lower the floor, a smaller call proving nothing new', () => {
        LLMWindowService.observeAccepted('a1', 'qwen3', 400048);
        mocks.writeFile.mockClear();
        LLMWindowService.observeAccepted('a1', 'qwen3', 1000);
        expect(mocks.writeFile).not.toHaveBeenCalled();
        expect(LLMWindowService.windowOf('a1', 'qwen3').lowerTokens).toBe(400048);
    });

    test('retires a ceiling the far end has just gone past', () => {
        // Either the provider raised the window or the name now points somewhere else. The call
        // that just succeeded outranks a refusal from before it.
        storedIs({model: 'qwen3', upperTokens: 32000});
        LLMWindowService.observeAccepted('a1', 'qwen3', 40000);
        expect(written()).toEqual({model: 'qwen3', lowerTokens: 40000});
    });

    test('ignores a turn that carried nothing', () => {
        LLMWindowService.observeAccepted('a1', 'qwen3', 0);
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    test('retires a disproved ceiling even on a call too small to raise the floor', () => {
        // The floor leaves early, having learned nothing. The ceiling is a separate question and
        // is asked first, so it does not ride on the answer to that one.
        storedIs({model: 'qwen3', lowerTokens: 400048, upperTokens: 32000});
        LLMWindowService.observeAccepted('a1', 'qwen3', 40000);
        expect(written()).toEqual({model: 'qwen3', lowerTokens: 400048});
    });
});

describe('learning from a refusal', () => {

    test('takes the window it named as the ceiling', () => {
        LLMWindowService.observeRefused('a1', 'qwen3', {tokens: 983616});
        expect(written()).toEqual({model: 'qwen3', upperTokens: 983616});
    });

    test('keeps the byte wall of the gateway apart from the window of the model', () => {
        LLMWindowService.observeRefused('a1', 'qwen3', {bytes: 6291456});
        expect(written()).toEqual({model: 'qwen3', bodyBytes: 6291456});
    });

    test('drops a floor the ceiling has come down under', () => {
        storedIs({model: 'qwen3', lowerTokens: 400048});
        LLMWindowService.observeRefused('a1', 'qwen3', {tokens: 32000});
        expect(written()).toEqual({model: 'qwen3', upperTokens: 32000});
    });

    test('leaves the floor where it stands when the ceiling clears it', () => {
        storedIs({model: 'qwen3', lowerTokens: 400048});
        LLMWindowService.observeRefused('a1', 'qwen3', {tokens: 983616});
        expect(written()).toEqual({model: 'qwen3', lowerTokens: 400048, upperTokens: 983616});
    });

    test('reads a ceiling off the floor when the refusal named no number', () => {
        // The one figure available that cannot be over the wall: the far end answered at it. An
        // estimate is a division by three and could land either side.
        storedIs({model: 'qwen3', lowerTokens: 100000});
        LLMWindowService.observeRefused('a1', 'qwen3', {}, 180000);
        expect(written()).toEqual({model: 'qwen3', upperTokens: 100000});
    });

    test('falls back to the estimate where no call has ever gone through', () => {
        LLMWindowService.observeRefused('a1', 'qwen3', {}, 180000);
        expect(written()).toEqual({model: 'qwen3', upperTokens: 180000});
    });

    test('keeps narrowing when a ceiling that should have prevented a refusal did not', () => {
        // A rule that can decline to move is a rule that can be asked three times and give up.
        storedIs({model: 'qwen3', upperTokens: 100000});
        LLMWindowService.observeRefused('a1', 'qwen3', {}, 180000);
        expect(written()).toEqual({model: 'qwen3', upperTokens: 80000});
        LLMWindowService.observeRefused('a1', 'qwen3', {}, 180000);
        expect(written()).toEqual({model: 'qwen3', upperTokens: 64000});
    });

    test('learns something from every refusal, however little it named', () => {
        // The invariant the whole recovery rests on. Every way out of being refused for a history
        // too long runs through a compaction, and a compaction with no ceiling to trim against
        // sends the same history to the summarizer and is refused for the same reason.
        for (const limit of [{}, {tokens: 983616}, {bytes: 6291456}]) {
            LLMWindowService.clear();
            mocks.writeFile.mockClear();
            LLMWindowService.observeRefused('a1', 'qwen3', limit, 180000);
            expect(mocks.writeFile).toHaveBeenCalledOnce();
        }
    });

    test('takes no ceiling from a silent refusal it can put no figure to', () => {
        LLMWindowService.observeRefused('a1', 'qwen3', {});
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    test('leaves the tokens alone where the refusal did name bytes', () => {
        // That wall was the bytes of the request and says nothing about the width of the window.
        // The summarizer call is kept under it by being trimmed in bytes as well.
        LLMWindowService.observeRefused('a1', 'qwen3', {bytes: 6291456}, 180000);
        expect(written()).toEqual({model: 'qwen3', bodyBytes: 6291456});
    });

    test('finishes the run even when it cannot write what it learned', () => {
        mocks.writeFile.mockImplementation(() => {
            throw new Error('read-only');
        });
        expect(() => LLMWindowService.observeRefused('a1', 'qwen3', {tokens: 983616})).not.toThrow();
        expect(LLMWindowService.windowOf('a1', 'qwen3').upperTokens).toBe(983616);
    });
});

describe('what the two checks measure against', () => {

    test('starts from the guess while nothing has been learned', () => {
        expect(LLMWindowService.budgetOf('a1', 'qwen3').tokens).toBe(UNLEARNED_TOKEN_BUDGET);
    });

    test('takes the margin off a ceiling that was measured', () => {
        LLMWindowService.observeRefused('a1', 'qwen3', {tokens: 983616});
        expect(LLMWindowService.budgetOf('a1', 'qwen3').tokens)
            .toBe(Math.floor(983616 * WINDOW_MARGIN));
    });

    test('allows a little more than the largest call known to have gone through', () => {
        // Exactly the floor would be a budget the conversation has already reached, so it would
        // compact every turn and never move. A fifth more is what turns it into a climb.
        LLMWindowService.observeAccepted('a1', 'qwen3', 400048);
        expect(LLMWindowService.budgetOf('a1', 'qwen3').tokens)
            .toBe(Math.floor(400048 * GROWTH_ALLOWANCE));
    });

    test('climbs toward a window nobody named, one proven call at a time', () => {
        let budget = LLMWindowService.budgetOf('a1', 'qwen3').tokens;
        // Every round sends what the budget allowed, which proves that much of the window.
        for (let round = 0; round < 12; round++) {
            LLMWindowService.observeAccepted('a1', 'qwen3', budget);
            const next = LLMWindowService.budgetOf('a1', 'qwen3').tokens;
            expect(next).toBeGreaterThan(budget);
            budget = next;
        }
        expect(budget).toBeGreaterThan(983616 * WINDOW_MARGIN);
    });

    test('stops climbing the moment a refusal names the real figure', () => {
        LLMWindowService.observeAccepted('a1', 'qwen3', 900000);
        expect(LLMWindowService.budgetOf('a1', 'qwen3').tokens).toBeGreaterThan(983616);
        LLMWindowService.observeRefused('a1', 'qwen3', {tokens: 983616});
        expect(LLMWindowService.budgetOf('a1', 'qwen3').tokens)
            .toBe(Math.floor(983616 * WINDOW_MARGIN));
    });

    test('gives the trimming something to work with after a refusal that named nothing', () => {
        // Without this the budget stays above the wall that was just hit, the whole history goes to
        // the summarizer, that call is refused too, and three of those end the conversation for
        // good -- a new message from the user starting the same three over.
        LLMWindowService.observeAccepted('a1', 'qwen3', 100000);
        const before = LLMWindowService.budgetOf('a1', 'qwen3').tokens;
        expect(before).toBeGreaterThan(100000);
        LLMWindowService.observeRefused('a1', 'qwen3', {}, 180000);
        expect(LLMWindowService.budgetOf('a1', 'qwen3').tokens).toBeLessThan(100000);
    });

    test('never drops below the guess on a floor smaller than it', () => {
        LLMWindowService.observeAccepted('a1', 'qwen3', 1000);
        expect(LLMWindowService.budgetOf('a1', 'qwen3').tokens).toBe(UNLEARNED_TOKEN_BUDGET);
    });

    test('falls back to the byte backstop while no gateway has named a wall', () => {
        // Untouched by the margin: it is nobody's wall, just a size no request should reach.
        expect(LLMWindowService.budgetOf('a1', 'qwen3').bytes).toBe(MAX_REQUEST_BYTES);
    });

    test('takes the margin off a byte wall that was measured', () => {
        // What is serialized is only part of what counts against the wall: the system prompt and
        // the tool schemas ride along, so compacting at the wall is compacting a turn too late.
        LLMWindowService.observeRefused('a1', 'qwen3', {bytes: 6291456});
        expect(LLMWindowService.budgetOf('a1', 'qwen3').bytes)
            .toBe(Math.floor(6291456 * WINDOW_MARGIN));
    });

    test('keeps the byte backstop clear of any window measured in tokens', () => {
        // Four mebibytes of chinese is over a million tokens, so for any real model the token side
        // speaks first and this catches only what no model could hold at all.
        expect(MAX_REQUEST_BYTES / 3).toBeGreaterThan(983616);
    });
});
