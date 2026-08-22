import {afterAll, afterEach, describe, expect, test, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {
    AgentHandler, AgentInteractionEvent, AgentInteractionEventPayload, AgentInvokeOptions,
    AgentInvokeResponse, AgentRuntime, ChatMessage,
} from '@deepclaw/core';

/**
 * The way from a chat that sends a message to a run that answers it, walked over the parts the
 * browser really talks to: the server actions, the sse server, the gateway and the store a tab
 * keeps. Only the two ends are played by stand-ins, the loop that answers and the react view.
 */

/** Importing the gateway bootstraps agent files, which a throwaway home keeps out of the repo. */
const deepclawHome = mkdtempSync(join(tmpdir(), 'deepclaw-loop-flow-'));
const previousHome = process.env['DEEPCLAW_HOME'];
process.env['DEEPCLAW_HOME'] = deepclawHome;

const {getLoopId, INTERACTION_TIMEOUT, newMessage, splitLoopId} = await import('@deepclaw/core');
const {LoopGateway} = await import('@deepclaw/loop-gateway');
/** Where the loop the gateway builds is taken over, the one thing here that cannot be real. */
const {LoopInitializer, ToolUseService} = await import('@deepclaw/agent');
const {SSEServer} = await import('@/app/api/sse-server');
const {
    activeLoop, inactiveLoop, invoke, pullNewerMessages, pullOlderMessages, pushChatMessage,
    resolveInteraction,
} = await import('@/server/loop-agent');

afterAll(() => {
    if (previousHome === undefined) {
        delete process.env['DEEPCLAW_HOME'];
    } else {
        process.env['DEEPCLAW_HOME'] = previousHome;
    }
    rmSync(deepclawHome, {recursive: true, force: true});
});

/** What the frames of the stream carry, of which every listener reads the few fields it knows. */
type Frame = {
    eventType: string;
    loopId?: string;
    browserId?: string;
    busy?: boolean;
    text?: string;
    done?: boolean;
    update?: boolean;
    message?: ChatMessage;
    content?: unknown;
};

let seq = 0;
const openBrowsers: FakeBrowser[] = [];

function nextLoop(): {loopId: string; agentId: string} {
    seq += 1;
    const agentId = `flow${seq}`;
    return {loopId: getLoopId('agent', agentId), agentId};
}

function emptyRuntime(): AgentRuntime {
    return {
        turnCount: 1,
        historyPersistIndex: 0,
        recoveryState: {maxTokenRetries: 0, refusalState: ''},
        usage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
    };
}

/**
 * The loop of one agent, without an llm behind it: the run is held open until the test says what it
 * answers, and what it streams or asks goes out the way a real loop's does.
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
                invoke: (_input: string, options: AgentInvokeOptions) =>
                    new Promise<AgentInvokeResponse>(resolve => {
                        this.options = options;
                        this.finishRun = resolve;
                    }),
            } as unknown as ReturnType<typeof LoopInitializer.getLoop>;
        });
    }

    public stream(text: string, done = false): void {
        this.handler.onStreamText({
            eventType: 'stream', loopId: this.loopId, browserId: this.browserId(), text, done,
        });
    }

    /**
     * Through the way the run brought where it brought one, the loop's own otherwise, which is what
     * a loop it spawned asks through as well: for a run of a chat the two are the same way.
     */
    public ask(payload: AgentInteractionEventPayload): Promise<string> {
        const question = {
            ...payload, eventType: 'interaction', loopId: this.loopId, browserId: this.browserId(),
        } as AgentInteractionEvent;
        const askOfThisRun = this.options?.agentHandler?.onInteractionEvent;
        return askOfThisRun ? askOfThisRun(question) : this.handler.onInteractionEvent(question);
    }

    public async finish(text: string): Promise<void> {
        this.finishRun!({text, runtime: emptyRuntime()});
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(this.loopId)).toBe(false));
    }

    private browserId(): string {
        return this.options?.browserId ?? '';
    }
}

/**
 * A tab, as the server knows it: one stream, the loops it says it has on screen, and the store the
 * chat keeps. The listeners of the chat view live only while the view is up, all but the one that
 * follows the stream of an answer, which outlives it the way the persistent one does.
 */
class FakeBrowser {
    public readonly browserId: string;
    public modal?: Frame;
    public readonly toasts: unknown[] = [];

    private streamId = 0;
    private readonly messages: Map<string, ChatMessage[]> = new Map();
    private readonly busyLoops: Map<string, boolean> = new Map();
    private streaming?: {loopId: string; msgId: string};
    private watching?: string;

    constructor(browserId: string) {
        this.browserId = browserId;
    }

    public open(): this {
        const decoder = new TextDecoder();
        const controller = {
            enqueue: (chunk: Uint8Array) => this.receive(decoder.decode(chunk)),
        } as unknown as ReadableStreamDefaultController;
        this.streamId = SSEServer.addClient(this.browserId, controller, new TextEncoder());
        return this;
    }

    /** The tab is gone, and the id it was known by goes with it: it lived in the session. */
    public close(): void {
        SSEServer.removeClient(this.browserId, this.streamId);
    }

    public async openChat(loopId: string): Promise<void> {
        const held = this.messages.get(loopId) ?? [];
        const newest = held[held.length - 1]?.id;
        const pulled = newest
            ? await pullNewerMessages(loopId, newest)
            : await pullOlderMessages(loopId);
        this.addPulled(loopId, pulled);
        this.watching = loopId;
        await activeLoop(this.browserId, loopId);
    }

    public async leaveChat(): Promise<void> {
        const loopId = this.watching!;
        this.watching = undefined;
        this.modal = undefined;
        await inactiveLoop(this.browserId, loopId);
    }

    public async send(loopId: string, text: string): Promise<void> {
        const {role, agentId, projectId = ''} = splitLoopId(loopId);
        const message = newMessage('user', agentId, text);
        this.append(loopId, message);
        await pushChatMessage(this.browserId, loopId, message);
        this.busyLoops.set(loopId, true);
        const {busy, msgId} = await invoke(this.browserId, role, agentId, projectId, text);
        if (!busy) {
            this.streaming = {loopId, msgId};
        }
    }

    public async answer(choice: string): Promise<void> {
        const loopId = this.modal!.loopId!;
        this.modal = undefined;
        await resolveInteraction(this.browserId, loopId, choice);
    }

    /** The text of the answer as the panel has it, which is the last thing the agent said. */
    public textOf(loopId: string): string | undefined {
        return [...(this.messages.get(loopId) ?? [])].reverse()
            .find(message => message.type === 'agent')?.content;
    }

    /** An agent message with nothing in it is what the panel shows the thinking label for. */
    public showsThinking(loopId: string): boolean {
        return this.textOf(loopId) === '';
    }

    public isBusy(loopId: string): boolean {
        return !!this.busyLoops.get(loopId);
    }

    private receive(frame: string): void {
        const [head, body] = frame.split('\ndata: ');
        this.handle({...JSON.parse(body!.trimEnd()), eventType: head!.slice('event: '.length)});
    }

    private handle(frame: Frame): void {
        // The stream of an answer is followed until it ends, whatever the view does meanwhile.
        if (frame.eventType === 'stream') {
            this.handleStream(frame);
            return;
        }
        if (frame.eventType === 'toast') {
            this.toasts.push(frame.content);
            return;
        }
        const loopId = frame.loopId;
        if (!loopId || loopId !== this.watching) {
            return;
        }
        if (frame.eventType === 'busy') {
            this.busyLoops.set(loopId, !!frame.busy);
        } else if (frame.eventType === 'chat' && frame.browserId !== this.browserId) {
            this.handleChat(loopId, frame);
        } else if (frame.eventType === 'interaction' && frame.browserId === this.browserId) {
            this.modal = frame;
        } else if (frame.eventType === 'cancelInteraction' && frame.browserId === this.browserId) {
            this.modal = undefined;
        }
    }

    private handleStream(frame: Frame): void {
        const streaming = this.streaming;
        if (!streaming || frame.browserId !== this.browserId || frame.loopId !== streaming.loopId) {
            return;
        }
        const message = (this.messages.get(streaming.loopId) ?? [])
            .find(item => item.id === streaming.msgId);
        if (message) {
            message.content += frame.text ?? '';
        }
        if (frame.done) {
            this.streaming = undefined;
        }
    }

    private handleChat(loopId: string, frame: Frame): void {
        const message = frame.message!;
        const known = (this.messages.get(loopId) ?? []).find(item => item.id === message.id);
        if (!frame.update) {
            this.append(loopId, message);
        } else if (known) {
            known.content = message.content;
        }
    }

    /** What comes back replaces what is held under the same id, half written as it may be. */
    private addPulled(loopId: string, pulled: ChatMessage[]): void {
        const held = this.messages.get(loopId) ?? [];
        for (const message of pulled) {
            const known = held.find(item => item.id === message.id);
            if (known) {
                known.content = message.content;
            } else {
                held.push({...message});
            }
        }
        this.messages.set(loopId, held);
    }

    private append(loopId: string, message: ChatMessage): void {
        this.messages.set(loopId, [...(this.messages.get(loopId) ?? []), {...message}]);
    }
}

function newBrowser(): FakeBrowser {
    seq += 1;
    const browser = new FakeBrowser(`b${seq}`);
    openBrowsers.push(browser);
    return browser;
}

afterEach(() => {
    openBrowsers.splice(0).forEach(browser => browser.close());
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('a chat that sends a message', () => {

    test('sees the answer as it is written and then whole', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const browser = newBrowser().open();
        await browser.openChat(loopId);

        await browser.send(loopId, 'hi');
        expect(browser.isBusy(loopId)).toBe(true);
        expect(browser.showsThinking(loopId)).toBe(true);
        agent.stream('Hel');
        agent.stream('lo');
        expect(browser.textOf(loopId)).toBe('Hello');

        agent.stream('', true);
        await agent.finish('Hello');
        expect(browser.textOf(loopId)).toBe('Hello');
        expect(browser.isBusy(loopId)).toBe(false);
    });

    /** What the first report of this was: the chat kept the thinking label of a run long over. */
    test('finds the answer whole on coming back to a run that ended elsewhere', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const browser = newBrowser().open();
        await browser.openChat(loopId);
        await browser.send(loopId, 'hi');

        await browser.leaveChat();
        agent.stream('nobody hears this');
        await agent.finish('the whole answer');

        await browser.openChat(loopId);
        expect(browser.textOf(loopId)).toBe('the whole answer');
        expect(browser.showsThinking(loopId)).toBe(false);
        expect(browser.isBusy(loopId)).toBe(false);
    });

    test('picks the stream up again on coming back to a run that is still on', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const browser = newBrowser().open();
        await browser.openChat(loopId);
        await browser.send(loopId, 'hi');
        agent.stream('one ');

        await browser.leaveChat();
        agent.stream('two ');
        await browser.openChat(loopId);
        agent.stream('three');
        // What was written while the page was elsewhere is not said again: the run says the whole of
        // it when it ends, and until then the chat shows what has arrived since it came back.
        expect(browser.textOf(loopId)).toBe('three');
        expect(browser.isBusy(loopId)).toBe(true);

        await agent.finish('one two three');
        expect(browser.textOf(loopId)).toBe('one two three');
    });

    test('answers the permission a run asks for, of the loop and of one it spawned', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const browser = newBrowser().open();
        await browser.openChat(loopId);
        await browser.send(loopId, 'clean it up');

        const askedByLoop = agent.ask({type: 'select', content: 'run rm -rf?', options: ['yes', 'no']});
        expect(browser.modal?.content).toBe('run rm -rf?');
        await browser.answer('yes');
        await expect(askedByLoop).resolves.toBe('yes');

        const askedBySpawned = agent.ask({type: 'input', content: 'which folder?'});
        expect(browser.modal?.content).toBe('which folder?');
        await browser.answer('/tmp');
        await expect(askedBySpawned).resolves.toBe('/tmp');

        await agent.finish('cleaned up');
        expect(browser.textOf(loopId)).toBe('cleaned up');
        expect(browser.isBusy(loopId)).toBe(false);
    });

    test('is toasted about a question asked while it was elsewhere and handed it on the way in', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const browser = newBrowser().open();
        await browser.openChat(loopId);
        await browser.send(loopId, 'clean it up');

        await browser.leaveChat();
        const asked = agent.ask({type: 'select', content: 'run rm -rf?', options: ['yes', 'no']});
        expect(browser.modal).toBeUndefined();
        expect(browser.toasts).toEqual([{key: 'interactionPause', data: loopId}]);

        await browser.openChat(loopId);
        expect(browser.modal?.content).toBe('run rm -rf?');
        await browser.answer('yes');
        await expect(asked).resolves.toBe('yes');

        await agent.finish('cleaned up');
        expect(browser.textOf(loopId)).toBe('cleaned up');
    });

    /** The messages are the server's, so a browser that was never there reads them all the same. */
    test('finds the answer of a run it left behind when a browser opens again', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const first = newBrowser().open();
        await first.openChat(loopId);
        await first.send(loopId, 'hi');

        first.close();
        await agent.finish('the whole answer');

        const second = newBrowser().open();
        await second.openChat(loopId);
        expect(second.textOf(loopId)).toBe('the whole answer');
        expect(second.showsThinking(loopId)).toBe(false);
        expect(second.isBusy(loopId)).toBe(false);
    });

    /**
     * The question was asked of a browser that had closed, which took its name with it: the one
     * that opens next is another browser as far as anything here can tell, and it is the one the
     * question is put to, since there is nobody else to put it to.
     */
    test('hands a question of a browser that closed to the one that opens next', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const first = newBrowser().open();
        await first.openChat(loopId);
        await first.send(loopId, 'hi');
        first.close();
        const asked = agent.ask({type: 'select', content: 'run rm -rf?', options: ['yes', 'no']});

        const second = newBrowser().open();
        expect(second.toasts).toEqual([{key: 'interactionPause', data: loopId}]);
        await second.openChat(loopId);
        expect(second.modal?.content).toBe('run rm -rf?');
        await second.answer('yes');
        await expect(asked).resolves.toBe('yes');

        await agent.finish('cleaned up');
        expect(second.textOf(loopId)).toBe('cleaned up');
        expect(second.isBusy(loopId)).toBe(false);
    });
});

/**
 * Ten minutes of silence end a question, and the loop is latched so that every tool call queued
 * behind it gives up at once instead of spending ten of its own on the same silence. The latch is
 * held by the run and lifted from here: somebody turning up on the loop is what undoes it.
 */
describe('a question nobody answered', () => {

    test('is taken off the screen, and the run goes on without it', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const browser = newBrowser().open();
        await browser.openChat(loopId);
        await browser.send(loopId, 'clean it up');

        vi.useFakeTimers();
        const asked = agent.ask({type: 'select', content: 'run rm -rf?', options: ['yes', 'no']});
        expect(browser.modal?.content).toBe('run rm -rf?');
        // Waited for before the clock moves: a rejection with nobody on it yet is an unhandled one.
        const givenUp = expect(asked).rejects.toBe('interactionAfk');
        vi.advanceTimersByTime(INTERACTION_TIMEOUT);
        await givenUp;
        expect(browser.modal).toBeUndefined();
        vi.useRealTimers();

        await agent.finish('left it alone');
        expect(browser.textOf(loopId)).toBe('left it alone');
        expect(browser.isBusy(loopId)).toBe(false);
    });

    test('leaves the toast of a browser that was elsewhere behind when it is over', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const browser = newBrowser().open();
        await browser.openChat(loopId);
        await browser.send(loopId, 'clean it up');
        await browser.leaveChat();

        vi.useFakeTimers();
        const asked = agent.ask({type: 'select', content: 'run rm -rf?', options: ['yes', 'no']});
        expect(browser.toasts).toEqual([{key: 'interactionPause', data: loopId}]);
        const givenUp = expect(asked).rejects.toBe('interactionAfk');
        vi.advanceTimersByTime(INTERACTION_TIMEOUT);
        await givenUp;
        vi.useRealTimers();

        // Nothing is left waiting, so a page opening the loop now is handed no question.
        await browser.openChat(loopId);
        expect(browser.modal).toBeUndefined();
    });

    test('lets the run ask again once the user is back on the loop', async () => {
        const {loopId} = nextLoop();
        new FakeAgent(loopId);
        const browser = newBrowser().open();
        await browser.openChat(loopId);
        await browser.send(loopId, 'hi');
        await browser.leaveChat();

        const askAgain = vi.spyOn(ToolUseService, 'clearAwayUser');
        await browser.openChat(loopId);
        expect(askAgain).toHaveBeenCalledWith(loopId);
    });

    /** The browser the run asks is here, so another page turning up buys the run nothing. */
    test('is left latched while the browser the run asks is here', async () => {
        const {loopId} = nextLoop();
        new FakeAgent(loopId);
        const first = newBrowser().open();
        await first.openChat(loopId);
        await first.send(loopId, 'hi');

        const askAgain = vi.spyOn(ToolUseService, 'clearAwayUser');
        const second = newBrowser().open();
        await second.openChat(loopId);
        expect(askAgain).not.toHaveBeenCalled();
    });

    test('lets the run ask again through the page that stands in for a browser that closed', async () => {
        const {loopId} = nextLoop();
        new FakeAgent(loopId);
        const first = newBrowser().open();
        await first.openChat(loopId);
        await first.send(loopId, 'hi');
        first.close();

        const askAgain = vi.spyOn(ToolUseService, 'clearAwayUser');
        const second = newBrowser().open();
        await second.openChat(loopId);
        expect(askAgain).toHaveBeenCalledWith(loopId);
    });
});
