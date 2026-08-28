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
    resolveInteraction, listSessions, pullSessionMessages, startNewSession,
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
    tag?: string;
    done?: boolean;
    update?: boolean;
    message?: ChatMessage;
    content?: unknown;
};

/** Loops and browsers are counted apart, so that the ids of a failing test read in order. */
let loopSeq = 0;
let browserSeq = 0;
const openBrowsers: FakeBrowser[] = [];

function nextLoop(): {loopId: string; agentId: string} {
    loopSeq += 1;
    const agentId = `flow${loopSeq}`;
    return {loopId: getLoopId('agent', agentId), agentId};
}

/** The other place a chat of this kind lives: a row of the board rather than a page of an agent. */
function nextProjectLoop(): {loopId: string; agentId: string; projectId: string} {
    loopSeq += 1;
    const agentId = `flow${loopSeq}`;
    const projectId = `project${loopSeq}`;
    return {loopId: getLoopId('project', agentId, projectId), agentId, projectId};
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
 * answers, and what it streams or asks goes out the way a real loop's does.
 */
class FakeAgent {
    private static readonly standIns: Map<string, FakeAgent> = new Map();

    private readonly loopId: string;
    private handler!: AgentHandler;
    private options?: AgentInvokeOptions;
    private finishRun?: (response: AgentInvokeResponse) => void;

    constructor(loopId: string) {
        this.loopId = loopId;
        FakeAgent.standIns.set(loopId, this);
        FakeAgent.install();
    }

    public static forgetAll(): void {
        this.standIns.clear();
    }

    /**
     * One factory for all of them, answering with the stand-in of the loop it is asked for. A spy
     * per agent would leave every loop with the handler of whichever was built last.
     */
    private static install(): void {
        if (vi.isMockFunction(LoopInitializer.getLoop)) {
            return;
        }
        vi.spyOn(LoopInitializer, 'getLoop').mockImplementation((role, agentId, projectId, handler) => {
            const loopId = getLoopId(role, agentId, projectId);
            const standIn = this.standIns.get(loopId);
            if (!standIn) {
                throw new Error(`No agent stands in for ${loopId}`);
            }
            return standIn.build(handler);
        });
    }

    private build(handler: AgentHandler): ReturnType<typeof LoopInitializer.getLoop> {
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
    }

    public stream(text: string, done = false): void {
        this.handler.onStreamText({
            eventType: 'stream', loopId: this.loopId, browserId: this.browserId(), text, done,
        });
    }

    /** A tool saying something about itself on the stream, in the shape that tool chose. */
    public streamTagged(text: string, tag: string): void {
        this.handler.onStreamText({
            eventType: 'stream', loopId: this.loopId, browserId: this.browserId(),
            text, tag, done: false,
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

    /**
     * The run ends. The line it ends on is its answer, and `said` is everything it had said by
     * then, which is more than the answer wherever the run narrated its way there.
     */
    public async finish(text: string, said: string = text): Promise<void> {
        this.finishRun!({text, said, runtime: emptyRuntime()});
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

    /**
     * The tab is reloaded. It comes back under the name it left with, since that name lived in the
     * session rather than in the page, and the stream it left behind ends only after the one that
     * took its place began. Everything the page held is gone, and it opens its chat anew.
     */
    public reload(): this {
        const left = this.streamId;
        this.messages.clear();
        this.busyLoops.clear();
        this.toasts.length = 0;
        this.streaming = undefined;
        this.watching = undefined;
        this.modal = undefined;
        this.open();
        SSEServer.removeClient(this.browserId, left);
        return this;
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

    /** Answers whether the run was already on, which is the chat being told to wait its turn. */
    public async send(loopId: string, text: string): Promise<boolean> {
        const {role, agentId, projectId = ''} = splitLoopId(loopId);
        const message = newMessage('user', agentId, text);
        this.append(loopId, message);
        await pushChatMessage(this.browserId, loopId, message);
        this.busyLoops.set(loopId, true);
        const {busy, msgId} = await invoke(this.browserId, role, agentId, projectId, text);
        if (!busy) {
            this.streaming = {loopId, msgId};
        }
        return busy;
    }

    /** The button in the header. Nothing is emptied here: the server says so, to every tab. */
    public async startNew(loopId: string) {
        return startNewSession(loopId);
    }

    /** What a conversation that was closed reads as, which is a page of it and no writing back. */
    public async readSession(loopId: string, sessionId: string): Promise<string[]> {
        const messages = await pullSessionMessages(loopId, sessionId);
        return messages.map(message => message.content);
    }

    public async answer(choice: string): Promise<void> {
        const loopId = this.modal?.loopId;
        if (!loopId) {
            throw new Error(`${this.browserId} was shown no question to answer`);
        }
        this.modal = undefined;
        await resolveInteraction(this.browserId, loopId, choice);
    }

    /** What a tab that was shown no question can still try, the server being the one that says no. */
    public tryAnswer(loopId: string, choice: string): Promise<boolean> {
        return resolveInteraction(this.browserId, loopId, choice);
    }

    /** The text of the answer as the panel has it, which is the last thing the agent said. */
    public textOf(loopId: string): string | undefined {
        return [...(this.messages.get(loopId) ?? [])].reverse()
            .find(message => message.type === 'agent')?.content;
    }

    /** Everything the panel lists, in the order it shows it. */
    public contentsOf(loopId: string): string[] {
        return (this.messages.get(loopId) ?? []).map(message => message.content);
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
        } else if (frame.eventType === 'sessionReset') {
            // Whoever asked for it is told along with the rest, so the panel is emptied here alone.
            this.messages.set(loopId, []);
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
        // Read by whoever knows the tag and by nobody else: the answer being written here is what
        // the run said, and a tool's own shape of words is no part of it.
        if (frame.tag) {
            return;
        }
        const message = (this.messages.get(streaming.loopId) ?? [])
            .find(item => item.id === streaming.msgId);
        if (!frame.done) {
            if (message) {
                message.content += frame.text ?? '';
            }
            return;
        }
        // Nothing is sent back: the tab reads the stream onto the screen and the server writes the
        // run down, so the whole of it arrives here once more as a message of its own.
        this.streaming = undefined;
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
    browserSeq += 1;
    const browser = new FakeBrowser(`b${browserSeq}`);
    openBrowsers.push(browser);
    return browser;
}

afterEach(() => {
    openBrowsers.splice(0).forEach(browser => browser.close());
    FakeAgent.forgetAll();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('a chat that sends a message', () => {

    // 发消息的聊天：答案边写边显示，run 结束时再整个替换一遍
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

    /**
     * What the first report of this was: a run narrated its way through a long piece of work and
     * the whole of it went off the screen as it ended, leaving the one sentence it ended on --
     * until the page was reloaded, which brought all of it back from the file.
     */
    // run 结束时留在聊天里的是全文，不是它最后那句话
    test('keeps the whole of what was written, not the line the run ended on', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const browser = newBrowser().open();
        await browser.openChat(loopId);

        await browser.send(loopId, 'hi');
        agent.stream('Read the file. ');
        agent.stream('Fixed the typo.');
        agent.stream('', true);
        await agent.finish('Fixed the typo.', 'Read the file. Fixed the typo.');

        expect(browser.textOf(loopId)).toBe('Read the file. Fixed the typo.');
        // And the file says the same, so nothing changes under a reload either way.
        await browser.reload().openChat(loopId);
        expect(browser.textOf(loopId)).toBe('Read the file. Fixed the typo.');
    });

    /**
     * A tool telling the stream where it has got to sends its own shape of words -- the step tool
     * sends the task as json -- and the chat has no reading of that but to print it. It stood in
     * the answer until the run ended and the message written from what was said wiped it, so what
     * it left was a flash of json in the middle of a sentence.
     */
    // 工具带 tag 发上流的东西不进聊天，比如 update_task_current_step 的那段 json
    test('leaves a tagged frame out of the answer it is writing', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const browser = newBrowser().open();
        await browser.openChat(loopId);

        await browser.send(loopId, 'hi');
        agent.stream('Working on it. ');
        agent.streamTagged('{"id":"design","currentStepIndex":1}', 'update_task_current_step');
        agent.stream('Done.');
        expect(browser.textOf(loopId)).toBe('Working on it. Done.');

        agent.stream('', true);
        await agent.finish('Done.', 'Working on it. Done.');
        expect(browser.textOf(loopId)).toBe('Working on it. Done.');
    });

    /** What the first report of this was: the chat kept the thinking label of a run long over. */
    // 回到一个在别处结束的 run，看到的是完整答案，而不是停在思考中
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

    /**
     * A call that never got off the ground says all it has to say at once: there is nothing to
     * stream, so the browser is left holding nothing of it. Sending that nothing back as what was
     * read would leave the error of the run behind an empty message, read as a run still thinking.
     */
    // 一次没有流式输出的回答（比如 403 报错），离开再回来看到的还是那条报错，不是思考中
    test('finds the answer of a run that streamed nothing on coming back', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const browser = newBrowser().open();
        await browser.openChat(loopId);
        await browser.send(loopId, 'hi');

        const failed = 'ERROR: Unrecoverable error: 403 Free quota exhausted.';
        agent.stream(failed, true);
        await agent.finish(failed);
        expect(browser.textOf(loopId)).toBe(failed);

        await browser.leaveChat();
        await browser.openChat(loopId);
        expect(browser.textOf(loopId)).toBe(failed);
        expect(browser.showsThinking(loopId)).toBe(false);
    });

    // 回到一个还在跑的 run，重新接上它的流
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

    // 回答 run 要的授权，本 loop 的和它派生出来的 loop 的都能答
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

    // 人在别处时被问，先收到 toast，点进来时再把问题交到手上
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

    /**
     * The reload is what all of this was built for. A tab comes back under the name it left with,
     * so the question it was asked is still its own to answer, and the stream it left behind ends
     * only after the one that replaced it began: were that late ending taken at face value, the tab
     * would be holding a stream the server no longer knows and would sit there hearing nothing.
     */
    // 刷新之后，原本问它的那个问题重新交回它手上
    test('is handed its question again after a reload', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const browser = newBrowser().open();
        await browser.openChat(loopId);
        await browser.send(loopId, 'clean it up');
        const asked = agent.ask({type: 'select', content: 'run rm -rf?', options: ['yes', 'no']});
        expect(browser.modal?.content).toBe('run rm -rf?');

        browser.reload();
        expect(browser.modal).toBeUndefined();

        await browser.openChat(loopId);
        expect(browser.contentsOf(loopId)).toEqual(['clean it up', '']);
        expect(browser.isBusy(loopId)).toBe(true);
        expect(browser.modal?.content).toBe('run rm -rf?');
        await browser.answer('yes');
        await expect(asked).resolves.toBe('yes');

        await agent.finish('cleaned up');
        expect(browser.textOf(loopId)).toBe('cleaned up');
        expect(browser.isBusy(loopId)).toBe(false);
    });

    /**
     * The run is one at a time. What the second message gets is an answer from the gateway rather
     * than from the agent, and the run that was already on is left to end in its own time.
     */
    // run 还在跑时又发一条，会被告知等一等
    test('is told to wait when it sends again while the run is on', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const browser = newBrowser().open();
        await browser.openChat(loopId);
        await browser.send(loopId, 'hi');

        expect(await browser.send(loopId, 'and this too')).toBe(true);
        expect(browser.showsThinking(loopId)).toBe(false);

        await agent.finish('the whole answer');
        expect(browser.contentsOf(loopId)).toContain('the whole answer');
        expect(browser.isBusy(loopId)).toBe(false);
    });

    /** The messages are the server's, so a browser that was never there reads them all the same. */
    // 换一个浏览器打开，照样读得到之前那个 run 留下的答案
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
    // 被提问的浏览器关掉了，问题转交给下一个打开的浏览器
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
 * One loop with two views open on it, which is a second tab, or the board and the page of an agent
 * at once. What is said in the loop is said to both. The question is not: it is asked of a browser
 * rather than of a loop, and the tab that was not asked is an onlooker.
 */
describe('two browsers on one loop', () => {

    // 两个浏览器看同一个 loop：一边发的消息和 run 的答案，另一边也看得到
    test('shows in one what the other sent and what the run answered', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const sender = newBrowser().open();
        const onlooker = newBrowser().open();
        await sender.openChat(loopId);
        await onlooker.openChat(loopId);

        await sender.send(loopId, 'hi');
        expect(onlooker.contentsOf(loopId)).toEqual(['hi', '']);
        expect(onlooker.isBusy(loopId)).toBe(true);

        // Tokens are sent to the view that asked for that answer by id, so the other is not written
        // into as the answer is written: what it is shown is the answer, once there is one.
        agent.stream('Hello');
        expect(sender.textOf(loopId)).toBe('Hello');
        expect(onlooker.textOf(loopId)).toBe('');

        await agent.finish('Hello');
        expect(onlooker.textOf(loopId)).toBe('Hello');
        expect(onlooker.isBusy(loopId)).toBe(false);
    });

    // 问题只给 run 点名的那个浏览器，旁观的那个既看不到也答不了
    test('puts a question to the browser the run asked and to no other', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const sender = newBrowser().open();
        const onlooker = newBrowser().open();
        await sender.openChat(loopId);
        await onlooker.openChat(loopId);
        await sender.send(loopId, 'clean it up');

        const asked = agent.ask({type: 'select', content: 'run rm -rf?', options: ['yes', 'no']});
        expect(sender.modal?.content).toBe('run rm -rf?');
        expect(onlooker.modal).toBeUndefined();
        // Somebody was shown the question, so nobody is toasted about it.
        expect(onlooker.toasts).toEqual([]);

        expect(await onlooker.tryAnswer(loopId, 'no')).toBe(false);
        await sender.answer('yes');
        await expect(asked).resolves.toBe('yes');
    });
});

/**
 * Closing a conversation, from the button in the header down to the folder on disk. What the header
 * offers is only worth as much as the whole of it holds together: the transcript has to be gone from
 * every tab, the history has to be gone from the loop that answers, and what was said has to be
 * readable afterwards. Any one of those alone is a conversation half closed.
 */
describe('a chat that closes its conversation', () => {

    // 开新对话：面板清空，说过的话进历史，还能读回来
    test('empties the panel and keeps what was said to be read back', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const browser = newBrowser().open();
        await browser.openChat(loopId);
        await browser.send(loopId, 'hi');
        await agent.finish('Hello');

        const result = await browser.startNew(loopId);
        expect(result.started).toBe(true);
        expect(browser.contentsOf(loopId)).toEqual([]);

        const sessions = await listSessions(loopId);
        expect(sessions).toHaveLength(1);
        expect(await browser.readSession(loopId, sessions[0]!.sessionId)).toEqual(['hi', 'Hello']);
    });

    // 另一个标签页也被告知，否则它会接着往一段已经不存在的对话里写
    test('tells the other tab, which was holding the same transcript', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const sender = newBrowser().open();
        const onlooker = newBrowser().open();
        await sender.openChat(loopId);
        await onlooker.openChat(loopId);
        await sender.send(loopId, 'hi');
        await agent.finish('Hello');
        expect(onlooker.contentsOf(loopId)).toEqual(['hi', 'Hello']);

        await sender.startNew(loopId);
        expect(onlooker.contentsOf(loopId)).toEqual([]);
    });

    /** The next turn has to start from an empty history, which is a loop built again. */
    // 下一轮从空上下文开始：新消息只剩它自己，不接在已结束的对话后面
    test('starts the next turn from an empty conversation', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const browser = newBrowser().open();
        await browser.openChat(loopId);
        await browser.send(loopId, 'hi');
        await agent.finish('Hello');
        await browser.startNew(loopId);

        await browser.send(loopId, 'and again');
        await agent.finish('Hi there');
        expect(browser.contentsOf(loopId)).toEqual(['and again', 'Hi there']);

        // What a tab that reloads is handed is the new conversation too, not the file as it was.
        await browser.reload().openChat(loopId);
        expect(browser.contentsOf(loopId)).toEqual(['and again', 'Hi there']);
    });

    // run 还在跑的时候拒绝：它正在写的东西会被截断，写进去的目录正要被移走
    test('refuses while the run is still going', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const browser = newBrowser().open();
        await browser.openChat(loopId);
        await browser.send(loopId, 'hi');

        expect(await browser.startNew(loopId)).toEqual({started: false, reason: 'busy'});
        expect(browser.contentsOf(loopId)).toEqual(['hi', '']);

        await agent.finish('Hello');
        expect((await browser.startNew(loopId)).started).toBe(true);
    });

    // 空对话不留下空目录：连点两次只归档说过话的那一段
    test('leaves nothing behind for a conversation nothing was said in', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const browser = newBrowser().open();
        await browser.openChat(loopId);
        await browser.send(loopId, 'hi');
        await agent.finish('Hello');

        await browser.startNew(loopId);
        expect(await browser.startNew(loopId)).toEqual({started: true, sessionId: undefined});
        expect(await listSessions(loopId)).toHaveLength(1);
    });

    // 每段对话的用量各算各的，回看旧的不会把用量算到新的头上
    test('lists what each conversation was', async () => {
        const {loopId} = nextLoop();
        const agent = new FakeAgent(loopId);
        const browser = newBrowser().open();
        await browser.openChat(loopId);
        await browser.send(loopId, 'first');
        await agent.finish('one');
        await browser.startNew(loopId);
        await browser.send(loopId, 'second');
        await agent.finish('two');
        await browser.startNew(loopId);

        const sessions = await listSessions(loopId);
        expect(sessions).toHaveLength(2);
        // The most recent one first, which is the one the second conversation was.
        expect(await browser.readSession(loopId, sessions[0]!.sessionId)).toEqual(['second', 'two']);
        expect(await browser.readSession(loopId, sessions[1]!.sessionId)).toEqual(['first', 'one']);
    });
});

/** The same walk from a row of the board, where the loop is of a project rather than of an agent. */
describe('a chat of a project', () => {

    // 项目的聊天：项目 run 的消息、提问和答案，整条链路一样走得通
    test('carries the message, the question and the answer of the project run', async () => {
        const {loopId} = nextProjectLoop();
        const agent = new FakeAgent(loopId);
        const browser = newBrowser().open();
        await browser.openChat(loopId);
        await browser.send(loopId, 'ship it');
        expect(browser.showsThinking(loopId)).toBe(true);

        const asked = agent.ask({type: 'input', content: 'which branch?'});
        expect(browser.modal?.content).toBe('which branch?');
        await browser.answer('main');
        await expect(asked).resolves.toBe('main');

        await agent.finish('shipped');
        expect(browser.textOf(loopId)).toBe('shipped');
        expect(browser.isBusy(loopId)).toBe(false);
    });
});

/**
 * Ten minutes of silence end a question. What the run makes of that silence is its own: it latches
 * the loop so that the tool calls queued behind the one that timed out give up at once instead of
 * spending ten minutes each on the same silence, which is walked in tool-use-service.spec. What is
 * walked here is the other half of it, the half no unit test can see: which of the things a browser
 * does amount to the user being back, and so tell the run that asking again is worth it.
 */
describe('a question nobody answered', () => {

    // 没人回答的问题：超时后弹框从屏幕上撤掉，run 不等它继续往下走
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

    // 问题作废后，人在别处的浏览器只剩那条 toast，再进来不会又被塞一个问题
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

    // 用户回到这个 loop，就让 run 可以重新发问
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
    // run 点名的浏览器还在，另开一个页面并不解闩
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

    // 顶替已关闭浏览器的那个页面，同样能让 run 重新发问
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
