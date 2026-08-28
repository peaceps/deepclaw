import {afterAll, afterEach, describe, expect, test, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {
    AgentHandler, AgentInteractionEvent, AgentInteractionEventPayload, AgentInvokeOptions,
    AgentInvokeResponse, AgentRuntime,
} from '@deepclaw/core';
import type {ParsedMessage} from './im-message-handler';

/**
 * The way from a message of a chat to a run and back, over the real gateway. A run started from a
 * chat answers there and asks there, and the browser the web flow leans on is nowhere in it: what
 * is faked is the engine of the chat and the loop that answers.
 */

/** A throwaway home stands in for a set up one, whose config is the one thing checked here. */
const deepclawHome = mkdtempSync(join(tmpdir(), 'deepclaw-im-flow-'));
const previousHome = process.env['DEEPCLAW_HOME'];
process.env['DEEPCLAW_HOME'] = deepclawHome;

vi.mock('@deepclaw/config', async importOriginal => ({
    ...(await importOriginal<typeof import('@deepclaw/config')>()),
    isCurrentConfigValid: () => true,
}));

const {getLoopId, INTERACTION_TIMEOUT} = await import('@deepclaw/core');
const {i18nInstance, init} = await import('@deepclaw/i18n');
/** The words of this package, which the package entry registers and a chat message is answered in. */
await import('../i18n/index');
const {LoopGateway} = await import('@deepclaw/loop-gateway');
/** Where the loop the gateway builds is taken over, the one thing here that cannot be real. */
const {LoopInitializer} = await import('@deepclaw/agent');
const {IMMessageHandler} = await import('./im-message-handler');

/** Nothing has a language until an app picks one, and every message here is worded in it. */
init('en');

afterAll(() => {
    if (previousHome === undefined) {
        delete process.env['DEEPCLAW_HOME'];
    } else {
        process.env['DEEPCLAW_HOME'] = previousHome;
    }
    rmSync(deepclawHome, {recursive: true, force: true});
});

type RawEvent = {id: string; text: string};

/** Stands in for the engine of a chat: what it was told is all a test looks at. */
class TestHandler extends IMMessageHandler<RawEvent, string> {
    public readonly sent: string[] = [];

    protected override parseMessage(event: RawEvent): ParsedMessage<string> | null {
        return {id: event.id, text: event.text, body: `to-${event.id}`};
    }

    protected override _sendMessage(_target: string, content: string): void {
        this.sent.push(content);
    }
}

function emptyRuntime(): AgentRuntime {
    return {
        turnCount: 1,
        historyPersistIndex: 0,
        recoveryState: {maxTokenRetries: 0, inputMaxTokenRetries: 0, refusalState: ''},
        usage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
    };
}

/**
 * The loop of one agent, without an llm behind it: the run is held open until the test says what it
 * answers, and it asks the way a real loop does, through the handler the run was started with.
 */
class FakeAgent {
    private readonly loopId: string;
    private handler!: AgentHandler;
    private options?: AgentInvokeOptions;
    private finishRun?: (response: AgentInvokeResponse) => void;

    constructor(loopId: string) {
        this.loopId = loopId;
        vi.spyOn(LoopInitializer, 'getLoop').mockImplementation((_role, _agentId, _projectId, handler) => {
            this.handler = handler;
            return {
                isOutdated: () => false,
                updateAgentConfig: () => undefined,
                carriedState: () => ({permissionWhiteList: new Set(), footPrints: []}),
                invoke: (_input: string, options: AgentInvokeOptions) =>
                    new Promise<AgentInvokeResponse>(resolve => {
                        this.options = options;
                        this.finishRun = resolve;
                    }),
            } as unknown as ReturnType<typeof LoopInitializer.getLoop>;
        });
    }

    /** A loop it spawned asks through the same way, which is the way the run brought. */
    public ask(payload: AgentInteractionEventPayload): Promise<string> {
        const question = {
            ...payload, eventType: 'interaction', loopId: this.loopId,
            browserId: this.options?.browserId ?? '',
        } as AgentInteractionEvent;
        const askOfThisRun = this.options?.agentHandler?.onInteractionEvent;
        return askOfThisRun ? askOfThisRun(question) : this.handler.onInteractionEvent(question);
    }

    public async finish(text: string): Promise<void> {
        this.finishRun!({text, runtime: emptyRuntime()});
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(this.loopId)).toBe(false));
    }
}

/** The handler puts the run on a promise chain, so the microtasks have to be drained. */
function flush(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

let seq = 0;

/** Every test works on its own agent so the static loop store cannot leak between tests. */
function newChat() {
    seq += 1;
    const agentId = `imflow${seq}`;
    return {
        handler: new TestHandler(agentId),
        agent: new FakeAgent(getLoopId('agent', agentId)),
        loopId: getLoopId('agent', agentId),
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('a chat that sends a message', () => {

    test('is asked to wait and is given the answer of the run', async () => {
        const {handler, agent} = newChat();
        handler.onMessage({id: 'm1', text: 'hi'});
        await flush();
        expect(handler.sent).toEqual([i18nInstance.t('im.wait')]);

        await agent.finish('here you are');
        expect(handler.sent.at(-1)).toBe('here you are');
    });

    test('is told the agent is busy when it sends again mid run', async () => {
        const {handler, agent} = newChat();
        handler.onMessage({id: 'm1', text: 'hi'});
        await flush();
        handler.onMessage({id: 'm2', text: 'and this'});
        await flush();
        expect(handler.sent.at(-1)).toBe(i18nInstance.t('im.busy'));

        await agent.finish('one at a time');
        expect(handler.sent.at(-1)).toBe('one at a time');
    });

    test('takes a message of its own as the answer to a question of the run', async () => {
        const {handler, agent} = newChat();
        handler.onMessage({id: 'm1', text: 'clean it up'});
        await flush();

        const asked = agent.ask({type: 'select', content: 'run rm -rf?', options: ['yes', 'no']});
        await flush();
        expect(handler.sent.at(-1)).toContain('run rm -rf?');
        // The options are offered by number, and the number is what comes back as the answer.
        handler.onMessage({id: 'm2', text: '1'});
        await expect(asked).resolves.toBe('yes');

        await agent.finish('cleaned up');
        expect(handler.sent.at(-1)).toBe('cleaned up');
    });

    /** A question of a loop the run spawned travels the way the run brought, like any other. */
    test('answers one question of the run after another', async () => {
        const {handler, agent} = newChat();
        handler.onMessage({id: 'm1', text: 'clean it up'});
        await flush();

        const asked = agent.ask({type: 'input', content: 'which folder?'});
        await flush();
        handler.onMessage({id: 'm2', text: '/tmp'});
        await expect(asked).resolves.toBe('/tmp');

        const askedAgain = agent.ask({type: 'select', content: 'sure?', options: ['yes', 'no']});
        await flush();
        expect(handler.sent.at(-1)).toContain('sure?');
        handler.onMessage({id: 'm3', text: '1'});
        await expect(askedAgain).resolves.toBe('yes');
    });

    /** The same ten minutes a browser is given, and the same word for having found nobody. */
    test('leaves a question nobody answered in ten minutes, and the run goes on', async () => {
        const {handler, agent} = newChat();
        handler.onMessage({id: 'm1', text: 'clean it up'});
        await flush();

        vi.useFakeTimers();
        const asked = agent.ask({type: 'select', content: 'run rm -rf?', options: ['yes', 'no']});
        // Waited for before the clock moves: a rejection with nobody on it yet is an unhandled one.
        const givenUp = expect(asked).rejects.toBe('interactionAfk');
        await vi.advanceTimersByTimeAsync(INTERACTION_TIMEOUT);
        await givenUp;
        vi.useRealTimers();

        await agent.finish('left it alone');
        expect(handler.sent.at(-1)).toBe('left it alone');
    });

    /**
     * The question stays in the chat it was asked in. Nothing of it is left with the gateway, so no
     * page can be handed it and no page counts as the user coming back to it either: the run says
     * it asks no browser, and a browser opening that loop is not who its silence was about.
     */
    test('keeps its questions to itself, out of reach of any page', async () => {
        const {handler, agent, loopId} = newChat();
        handler.onMessage({id: 'm1', text: 'clean it up'});
        await flush();
        expect(LoopGateway.askedBrowser(loopId)).toBeUndefined();

        const asked = agent.ask({type: 'select', content: 'run rm -rf?', options: ['yes', 'no']});
        await flush();
        expect(LoopGateway.waitingQuestions().filter(question => question.loopId === loopId))
            .toEqual([]);
        expect(LoopGateway.pendingInteraction('', loopId)).toBeUndefined();

        handler.onMessage({id: 'm2', text: '1'});
        await expect(asked).resolves.toBe('yes');
        await agent.finish('cleaned up');
    });
});
