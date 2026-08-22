import {afterAll, beforeEach, describe, expect, test, vi, type Mock} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {type AgentInteractionEvent} from '@deepclaw/core';
import {type LoopGatewayEvent} from '@deepclaw/loop-gateway';
import {type SSEEvent} from './sse-types';

const mocks = vi.hoisted(() => ({
    gateway: undefined as typeof import('@deepclaw/loop-gateway') | undefined,
    nodeUtils: undefined as typeof import('@deepclaw/node-utils') | undefined,
    subscribe: vi.fn<(listener: (event: LoopGatewayEvent) => void) => () => void>(),
    unsubscribe: vi.fn<() => void>(),
    isLoopBusy: vi.fn<(loopId: string) => boolean>(),
    pendingInteraction: vi.fn<(browserId: string, loopId: string) => AgentInteractionEvent | undefined>(),
    cancelInteraction: vi.fn<(browserId: string, loopId: string, reason: string) => void>(),
    waitingQuestions: vi.fn<() => AgentInteractionEvent[]>(),
    askAgainOf: vi.fn<(browserId: string, loopId: string) => AgentInteractionEvent | undefined>(),
    askedBrowser: vi.fn<(loopId: string) => string | undefined>(),
    askAgain: vi.fn<(loopId: string) => void>(),
    error: vi.fn<(message: string) => void>(),
}));

/** The real event predicates are kept, but importing them bootstraps agent files, so they are cached. */
vi.mock('@deepclaw/loop-gateway', async importOriginal => {
    const original = mocks.gateway ??= await importOriginal<typeof import('@deepclaw/loop-gateway')>();
    return {
        ...original,
        LoopGateway: {
            subscribe: mocks.subscribe,
            isLoopBusy: mocks.isLoopBusy,
            pendingInteraction: mocks.pendingInteraction,
            cancelInteraction: mocks.cancelInteraction,
            waitingQuestions: mocks.waitingQuestions,
            askAgainOf: mocks.askAgainOf,
            askedBrowser: mocks.askedBrowser,
            askAgain: mocks.askAgain,
        },
    };
});

vi.mock('@deepclaw/node-utils', async importOriginal => ({
    ...(mocks.nodeUtils ??= await importOriginal<typeof import('@deepclaw/node-utils')>()),
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.error}),
}));

/**
 * Importing the gateway bootstraps agent files into the working dir. A throwaway home keeps that
 * copy out of the repo, and away from the workers that read the same files in parallel.
 */
const deepclawHome = mkdtempSync(join(tmpdir(), 'deepclaw-sse-'));
const previousHome = process.env['DEEPCLAW_HOME'];
process.env['DEEPCLAW_HOME'] = deepclawHome;

/** That one-off import runs while the file loads so it cannot eat into a hook timeout. */
await import('@deepclaw/loop-gateway');

afterAll(() => {
    if (previousHome === undefined) {
        delete process.env['DEEPCLAW_HOME'];
    } else {
        process.env['DEEPCLAW_HOME'] = previousHome;
    }
    rmSync(deepclawHome, {recursive: true, force: true});
});

type SSEServerType = (typeof import('./sse-server'))['SSEServer'];

type FakeClient = {
    browserId: string;
    streamId: number;
    frames: string[];
    enqueue: Mock<(chunk: Uint8Array) => void>;
};

/** The server is a globalized singleton, so the global slot is dropped to give every test its own store. */
async function loadServer(): Promise<SSEServerType> {
    delete (globalThis as unknown as Record<string, unknown>)['__SSEServer'];
    vi.resetModules();
    return (await import('./sse-server')).SSEServer;
}

function addClient(server: SSEServerType, browserId: string): FakeClient {
    const frames: string[] = [];
    const decoder = new TextDecoder();
    const enqueue = vi.fn<(chunk: Uint8Array) => void>(chunk => {
        frames.push(decoder.decode(chunk));
    });
    const controller = {enqueue} as unknown as ReadableStreamDefaultController;
    const streamId = server.addClient(browserId, controller, new TextEncoder());
    return {browserId, streamId, frames, enqueue};
}

/** What the endpoint does when a stream is over: it names the stream it held, not just the browser. */
function removeClient(server: SSEServerType, client: FakeClient): void {
    server.removeClient(client.browserId, client.streamId);
}

/** Drops the busy frame that every browser is greeted with when it starts watching a loop. */
function watch(server: SSEServerType, client: FakeClient, loopId: string): FakeClient {
    server.watchLoop(client.browserId, loopId, true);
    client.frames.length = 0;
    return client;
}

function addWatcher(server: SSEServerType, browserId: string, loopId: string): FakeClient {
    return watch(server, addClient(server, browserId), loopId);
}

function received(client: FakeClient): SSEEvent[] {
    return client.frames.map(frame => JSON.parse(frame.split('\ndata: ')[1]!.trimEnd()) as SSEEvent);
}

function eventTypes(client: FakeClient): string[] {
    return client.frames.map(frame => frame.split('\n')[0]!.slice('event: '.length));
}

function fire(event: SSEEvent): void {
    mocks.subscribe.mock.calls[0]![0](event as LoopGatewayEvent);
}

function busyEvent(loopId: string, busy = true): SSEEvent {
    return {eventType: 'busy', loopId, busy} as SSEEvent;
}

function streamEvent(browserId: string, loopId: string): SSEEvent {
    return {eventType: 'stream', loopId, browserId, text: 'hi'} as SSEEvent;
}

function interactionEvent(browserId: string, loopId: string): AgentInteractionEvent {
    return {eventType: 'interaction', loopId, browserId, type: 'input', content: 'your name?'};
}

let server: SSEServerType;

beforeEach(async () => {
    vi.clearAllMocks();
    mocks.subscribe.mockReturnValue(mocks.unsubscribe);
    mocks.isLoopBusy.mockReturnValue(false);
    mocks.pendingInteraction.mockReturnValue(undefined);
    mocks.waitingQuestions.mockReturnValue([]);
    mocks.askAgainOf.mockReturnValue(undefined);
    mocks.askedBrowser.mockReturnValue(undefined);
    server = await loadServer();
});

describe('addClient', () => {

    test('subscribes to the gateway for the first client', () => {
        addClient(server, 'b1');
        expect(mocks.subscribe).toHaveBeenCalledOnce();
    });

    test('keeps a single subscription for further clients', () => {
        addClient(server, 'b1');
        addClient(server, 'b2');
        expect(mocks.subscribe).toHaveBeenCalledOnce();
    });

    test('says nothing to a new client', () => {
        expect(addClient(server, 'b1').frames).toEqual([]);
    });

    test('watches nothing until the browser says so', () => {
        const client = addClient(server, 'b1');
        fire(busyEvent('agent.a1'));
        expect(client.frames).toEqual([]);
    });

    test('replaces an earlier stream of the same browser', () => {
        const first = addClient(server, 'b1');
        const second = addClient(server, 'b1');
        fire({eventType: 'updateAgent', content: {id: 'a1'}});
        expect(first.frames).toEqual([]);
        expect(received(second)).toHaveLength(1);
    });

    /** The browser that was asked closed for good, so this one is who the question is left to. */
    test('tells a new browser about a question left behind by one that is gone', () => {
        mocks.waitingQuestions.mockReturnValue([interactionEvent('gone', 'agent.a1')]);
        expect(received(addClient(server, 'b1'))).toEqual([
            {eventType: 'toast', content: {key: 'interactionPause', data: 'agent.a1'}},
        ]);
    });

    /** Its own question is not news to it, and it is handed the question when it opens the loop. */
    test('says nothing to a browser about the question it is itself being asked', () => {
        mocks.waitingQuestions.mockReturnValue([interactionEvent('b1', 'agent.a1')]);
        expect(addClient(server, 'b1').frames).toEqual([]);
    });

    test('says nothing about a question the browser it waits for is here to answer', () => {
        addClient(server, 'b1');
        mocks.waitingQuestions.mockReturnValue([interactionEvent('b1', 'agent.a1')]);
        expect(addClient(server, 'b2').frames).toEqual([]);
    });
});

describe('watchLoop', () => {

    test('greets the browser with the busy state of the loop it takes up', () => {
        mocks.isLoopBusy.mockReturnValue(true);
        const client = addClient(server, 'b1');
        server.watchLoop('b1', 'agent.a1', true);
        expect(mocks.isLoopBusy).toHaveBeenCalledWith('agent.a1');
        expect(received(client)).toEqual([{eventType: 'busy', loopId: 'agent.a1', content: '', busy: true}]);
    });

    test('greets it about an idle loop as well', () => {
        const client = addClient(server, 'b1');
        server.watchLoop('b1', 'agent.a1', true);
        expect(received(client)).toEqual([{eventType: 'busy', loopId: 'agent.a1', content: '', busy: false}]);
    });

    test('sends the events of the loop it watches', () => {
        const client = addWatcher(server, 'b1', 'agent.a1');
        fire(busyEvent('agent.a1'));
        expect(received(client)).toHaveLength(1);
    });

    /** The toast that brought the user here says there is a question, the question itself is here. */
    test('hands over the question this browser was asked while it watched nothing', () => {
        mocks.pendingInteraction.mockReturnValue(interactionEvent('b1', 'agent.a1'));
        const client = addClient(server, 'b1');
        server.watchLoop('b1', 'agent.a1', true);
        expect(mocks.pendingInteraction).toHaveBeenCalledWith('b1', 'agent.a1');
        expect(eventTypes(client)).toEqual(['busy', 'interaction']);
    });

    /** The question was asked of a browser that closed, so this one is offered it instead. */
    test('hands over a question left behind by a browser that is gone', () => {
        mocks.waitingQuestions.mockReturnValue([interactionEvent('gone', 'agent.a1')]);
        mocks.askAgainOf.mockReturnValue(interactionEvent('b1', 'agent.a1'));
        const client = addClient(server, 'b1');
        client.frames.length = 0;
        server.watchLoop('b1', 'agent.a1', true);
        expect(mocks.askAgainOf).toHaveBeenCalledExactlyOnceWith('b1', 'agent.a1');
        expect(eventTypes(client)).toEqual(['busy', 'interaction']);
    });

    /** That browser is here and was asked: taking its question away would only confuse both. */
    test('leaves the question of a browser that is still here to it', () => {
        addClient(server, 'b1');
        mocks.waitingQuestions.mockReturnValue([interactionEvent('b1', 'agent.a1')]);
        const client = addClient(server, 'b2');
        server.watchLoop('b2', 'agent.a1', true);
        expect(mocks.askAgainOf).not.toHaveBeenCalled();
        expect(eventTypes(client)).toEqual(['busy']);
    });

    test('leaves a question of another loop where it is', () => {
        mocks.waitingQuestions.mockReturnValue([interactionEvent('gone', 'agent.a2')]);
        const client = addClient(server, 'b1');
        client.frames.length = 0;
        server.watchLoop('b1', 'agent.a1', true);
        expect(mocks.askAgainOf).not.toHaveBeenCalled();
        expect(eventTypes(client)).toEqual(['busy']);
    });

    /** A run that gave up on asking this browser is told the user is back on the loop. */
    test('has the run ask again the browser it puts its questions to', () => {
        mocks.askedBrowser.mockReturnValue('b1');
        addClient(server, 'b1');
        server.watchLoop('b1', 'agent.a1', true);
        expect(mocks.askAgain).toHaveBeenCalledExactlyOnceWith('agent.a1');
    });

    /** The one being asked is here, so another browser turning up buys the run nothing. */
    test('leaves the run alone for a browser it is not asking', () => {
        mocks.askedBrowser.mockReturnValue('b1');
        addClient(server, 'b1');
        addClient(server, 'b2');
        server.watchLoop('b2', 'agent.a1', true);
        expect(mocks.askAgain).not.toHaveBeenCalled();
    });

    /** Nobody else is going to answer for a browser that closed, so this one stands in for it. */
    test('has the run ask again when the browser it was asking is gone', () => {
        mocks.askedBrowser.mockReturnValue('gone');
        addClient(server, 'b1');
        server.watchLoop('b1', 'agent.a1', true);
        expect(mocks.askAgain).toHaveBeenCalledExactlyOnceWith('agent.a1');
    });

    /** A run that asks in a chat instead of a browser is not waiting on any page. */
    test('leaves a run that asks no browser alone', () => {
        mocks.askedBrowser.mockReturnValue(undefined);
        addClient(server, 'b1');
        server.watchLoop('b1', 'agent.a1', true);
        expect(mocks.askAgain).not.toHaveBeenCalled();
    });

    test('asks for nothing on the way out', () => {
        addWatcher(server, 'b1', 'agent.a1');
        mocks.pendingInteraction.mockClear();
        mocks.askAgain.mockClear();
        server.watchLoop('b1', 'agent.a1', false);
        expect(mocks.pendingInteraction).not.toHaveBeenCalled();
        expect(mocks.askAgain).not.toHaveBeenCalled();
    });

    test('stops sending them once the browser dropped the loop', () => {
        const client = addWatcher(server, 'b1', 'agent.a1');
        server.watchLoop('b1', 'agent.a1', false);
        fire(busyEvent('agent.a1'));
        expect(client.frames).toEqual([]);
    });

    test('keeps the loops of one browser apart', () => {
        const client = addWatcher(server, 'b1', 'agent.a1');
        server.watchLoop('b1', 'agent.a2', true);
        client.frames.length = 0;
        server.watchLoop('b1', 'agent.a1', false);
        fire(busyEvent('agent.a2'));
        expect(received(client)).toHaveLength(1);
    });

    test('leaves the loops of another browser untouched', () => {
        addWatcher(server, 'b1', 'agent.a1');
        const other = addWatcher(server, 'b2', 'agent.a1');
        server.watchLoop('b1', 'agent.a1', false);
        fire(busyEvent('agent.a1'));
        expect(received(other)).toHaveLength(1);
    });

    test('ignores a browser that has no stream', () => {
        expect(() => server.watchLoop('ghost', 'agent.a1', true)).not.toThrow();
        expect(mocks.isLoopBusy).not.toHaveBeenCalled();
    });

    test('ignores a loop the browser never took up', () => {
        const client = addClient(server, 'b1');
        expect(() => server.watchLoop('b1', 'agent.ghost', false)).not.toThrow();
        expect(client.frames).toEqual([]);
    });
});

describe('info events', () => {

    test('sends an agent update to every client', () => {
        const first = addClient(server, 'b1');
        const second = addClient(server, 'b2');
        fire({eventType: 'updateAgent', content: {id: 'a1'}});
        expect(received(first)).toEqual([{eventType: 'updateAgent', content: {id: 'a1'}}]);
        expect(received(second)).toEqual([{eventType: 'updateAgent', content: {id: 'a1'}}]);
    });

    test('names the event type in the frame header', () => {
        const client = addClient(server, 'b1');
        fire({eventType: 'updateProject', content: {id: 'p1'}});
        expect(eventTypes(client)).toEqual(['updateProject']);
    });

    test('sends a cron update as an info event', () => {
        const client = addClient(server, 'b1');
        fire({eventType: 'updateCron', content: {id: 'c1'}});
        expect(received(client)).toEqual([{eventType: 'updateCron', content: {id: 'c1'}}]);
    });

    test('reaches a client whatever loops it watches', () => {
        const client = addWatcher(server, 'b1', 'agent.a1');
        fire({eventType: 'updateAgent', content: {id: 'a1'}});
        expect(eventTypes(client)).toEqual(['updateAgent']);
    });

    test('ignores an event that is neither an info nor a loop event', () => {
        const client = addClient(server, 'b1');
        fire({eventType: 'connected', content: 'b1'});
        expect(client.frames).toEqual([]);
    });
});

describe('loop events', () => {

    test('sends a busy event to every browser watching that loop', () => {
        const first = addWatcher(server, 'b1', 'agent.a1');
        const second = addWatcher(server, 'b2', 'agent.a1');
        fire(busyEvent('agent.a1'));
        expect(received(first)).toEqual([{eventType: 'busy', loopId: 'agent.a1', busy: true}]);
        expect(received(second)).toHaveLength(1);
    });

    test('skips the browsers watching another loop', () => {
        const other = addWatcher(server, 'b1', 'agent.a2');
        fire(busyEvent('agent.a1'));
        expect(other.frames).toEqual([]);
    });

    test('sends a token usage event to the browsers watching that loop', () => {
        const client = addWatcher(server, 'b1', 'agent.a1');
        const usage = {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3};
        fire({eventType: 'tokenUsage', loopId: 'agent.a1', usage} as SSEEvent);
        expect(received(client)).toEqual([{eventType: 'tokenUsage', loopId: 'agent.a1', usage}]);
    });

    test('sends a chat event to the other browsers watching the loop', () => {
        const author = addWatcher(server, 'b1', 'agent.a1');
        const listener = addWatcher(server, 'b2', 'agent.a1');
        fire({eventType: 'chat', loopId: 'agent.a1', browserId: 'b1', update: false, message: {id: 'm1'}} as SSEEvent);
        expect(author.frames).toEqual([]);
        expect(received(listener)).toHaveLength(1);
    });

    test('sends a stream event only to the browser it belongs to', () => {
        const owner = addWatcher(server, 'b1', 'agent.a1');
        const other = addWatcher(server, 'b2', 'agent.a1');
        fire(streamEvent('b1', 'agent.a1'));
        expect(received(owner)).toHaveLength(1);
        expect(other.frames).toEqual([]);
    });

    test('sends a stream event of a loop the browser does not watch nowhere', () => {
        const client = addWatcher(server, 'b1', 'agent.a1');
        fire(streamEvent('b1', 'agent.a2'));
        expect(client.frames).toEqual([]);
    });

    test('sends an interaction event to the browser watching that loop', () => {
        const client = addWatcher(server, 'b1', 'agent.a1');
        fire(interactionEvent('b1', 'agent.a1'));
        expect(eventTypes(client)).toEqual(['interaction']);
        expect(mocks.cancelInteraction).not.toHaveBeenCalled();
    });

    test('sends a cancel interaction event to that browser as well', () => {
        const client = addWatcher(server, 'b1', 'agent.a1');
        fire({eventType: 'cancelInteraction', loopId: 'agent.a1', browserId: 'b1'} as SSEEvent);
        expect(received(client)).toEqual([{eventType: 'cancelInteraction', loopId: 'agent.a1', browserId: 'b1'}]);
    });

    test('skips a browser that dropped the loop for a cancel interaction event', () => {
        const client = addWatcher(server, 'b1', 'agent.a1');
        server.watchLoop('b1', 'agent.a1', false);
        fire({eventType: 'cancelInteraction', loopId: 'agent.a1', browserId: 'b1'} as SSEEvent);
        expect(client.frames).toEqual([]);
    });
});

describe('interactions nobody listens to', () => {

    /** The question keeps waiting in the gateway, so the toast has somewhere to send the user. */
    test('toasts the browser that is still connected and leaves the question waiting', () => {
        const client = addClient(server, 'b1');
        fire(interactionEvent('b1', 'agent.a1'));
        expect(mocks.cancelInteraction).not.toHaveBeenCalled();
        expect(received(client)).toEqual([
            {eventType: 'toast', content: {key: 'interactionPause', data: 'agent.a1'}},
        ]);
    });

    test('toasts a browser that dropped the loop as well', () => {
        const client = addWatcher(server, 'b1', 'agent.a1');
        server.watchLoop('b1', 'agent.a1', false);
        fire(interactionEvent('b1', 'agent.a1'));
        expect(mocks.cancelInteraction).not.toHaveBeenCalled();
        expect(eventTypes(client)).toEqual(['toast']);
    });

    /**
     * A reload is a browser away for a moment, and the page that returns is handed the question. A
     * run with no browser at all never reaches this: the gateway refuses to ask on its behalf.
     */
    test('leaves the question of a browser that is not connected waiting for it', () => {
        addClient(server, 'b2');
        fire(interactionEvent('b1', 'agent.a1'));
        expect(mocks.cancelInteraction).not.toHaveBeenCalled();
    });

    test('leaves other loop events alone when nobody listens', () => {
        addClient(server, 'b1');
        fire(busyEvent('agent.a1'));
        expect(mocks.cancelInteraction).not.toHaveBeenCalled();
    });
});

describe('sendToast', () => {

    test('reaches every client when no browser is named', () => {
        const first = addClient(server, 'b1');
        const second = addClient(server, 'b2');
        server.sendToast({key: 'imConnected', data: 'Ada'});
        const toast = {eventType: 'toast', content: {key: 'imConnected', data: 'Ada'}};
        expect(received(first)).toEqual([toast]);
        expect(received(second)).toEqual([toast]);
    });

    test('reaches only the browser it names', () => {
        const named = addClient(server, 'b1');
        const other = addClient(server, 'b2');
        server.sendToast({key: 'imConnectFailed', data: 'Ada'}, 'b1');
        expect(eventTypes(named)).toEqual(['toast']);
        expect(other.frames).toEqual([]);
    });

    test('stays quiet for a browser that is not connected', () => {
        const client = addClient(server, 'b1');
        expect(() => server.sendToast({key: 'imConnected', data: 'Ada'}, 'ghost')).not.toThrow();
        expect(client.frames).toEqual([]);
    });

    test('stays quiet when nobody is connected at all', () => {
        expect(() => server.sendToast({key: 'imConnected', data: 'Ada'})).not.toThrow();
    });
});

describe('a client whose stream is gone', () => {

    function breakClient(client: FakeClient): void {
        client.enqueue.mockImplementation(() => {
            throw new Error('stream closed');
        });
    }

    test('drops the client and writes to it no more', () => {
        const client = addWatcher(server, 'b1', 'agent.a1');
        breakClient(client);
        fire(busyEvent('agent.a1'));
        client.enqueue.mockClear();
        fire(busyEvent('agent.a1'));
        expect(client.enqueue).not.toHaveBeenCalled();
    });

    /** The loops it watched are owed an answer still, and the browser it belonged to may return. */
    test('leaves the questions of every loop it was watching waiting', () => {
        const client = addWatcher(server, 'b1', 'agent.a1');
        server.watchLoop('b1', 'agent.a2', true);
        breakClient(client);
        fire(busyEvent('agent.a1'));
        expect(mocks.cancelInteraction).not.toHaveBeenCalled();
    });

    test('logs the browser it failed on', () => {
        const client = addWatcher(server, 'b1', 'agent.a1');
        breakClient(client);
        fire(busyEvent('agent.a1'));
        expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('Failed to send to client b1'));
    });

    test('drops a client that watches nothing as well', () => {
        const client = addClient(server, 'b1');
        breakClient(client);
        fire({eventType: 'updateAgent', content: {id: 'a1'}});
        client.enqueue.mockClear();
        fire({eventType: 'updateAgent', content: {id: 'a1'}});
        expect(client.enqueue).not.toHaveBeenCalled();
        expect(mocks.cancelInteraction).not.toHaveBeenCalled();
    });

    test('keeps serving the clients that are still alive', () => {
        const broken = addWatcher(server, 'b1', 'agent.a1');
        const healthy = addWatcher(server, 'b2', 'agent.a1');
        breakClient(broken);
        fire(busyEvent('agent.a1'));
        expect(received(healthy)).toHaveLength(1);
    });
});

describe('removeClient', () => {

    /** The run of that browser is none of the business of a stream that left: it keeps going. */
    test('leaves the loops of the browser running and their questions waiting', () => {
        removeClient(server, addWatcher(server, 'b1', 'agent.a1'));
        expect(mocks.cancelInteraction).not.toHaveBeenCalled();
    });

    test('unsubscribes from the gateway once the last client left', () => {
        removeClient(server, addClient(server, 'b1'));
        expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    });

    test('keeps the subscription while another client stays', () => {
        const first = addClient(server, 'b1');
        addClient(server, 'b2');
        removeClient(server, first);
        expect(mocks.unsubscribe).not.toHaveBeenCalled();
    });

    test('subscribes again when a client comes back', () => {
        removeClient(server, addClient(server, 'b1'));
        addClient(server, 'b1');
        expect(mocks.subscribe).toHaveBeenCalledTimes(2);
    });

    test('stops sending to a client that left', () => {
        const client = addWatcher(server, 'b1', 'agent.a1');
        removeClient(server, client);
        addClient(server, 'b2');
        fire(busyEvent('agent.a1'));
        expect(client.frames).toEqual([]);
    });

    test('forgets the loops it was watching', () => {
        const client = addWatcher(server, 'b1', 'agent.a1');
        removeClient(server, client);
        addClient(server, 'b1');
        fire(busyEvent('agent.a1'));
        expect(client.frames).toEqual([]);
    });

    /**
     * A reload can be through before the stream it left behind is noticed to be over, and the two
     * are the same browser: the one that ends last would take the page that is here now with it.
     */
    test('leaves the stream that took its place alone', () => {
        const before = addClient(server, 'b1');
        const reloaded = addClient(server, 'b1');
        removeClient(server, before);
        watch(server, reloaded, 'agent.a1');
        fire(busyEvent('agent.a1'));
        expect(received(reloaded)).toHaveLength(1);
        expect(mocks.unsubscribe).not.toHaveBeenCalled();
    });

    test('accepts a browser that was never registered', () => {
        const client = addClient(server, 'b1');
        expect(() => removeClient(server, {...client, browserId: 'ghost'})).not.toThrow();
        expect(mocks.unsubscribe).not.toHaveBeenCalled();
    });
});
