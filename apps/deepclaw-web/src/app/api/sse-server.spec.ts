import {afterAll, beforeEach, describe, expect, test, vi, type Mock} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {type AgentInteractionEvent} from '@deepclaw/core';
import {type LoopGatewayEvent} from '@deepclaw/loop-gateway';
import {type SSEEvent, type SSEType} from './sse-types';

const mocks = vi.hoisted(() => ({
    gateway: undefined as typeof import('@deepclaw/loop-gateway') | undefined,
    nodeUtils: undefined as typeof import('@deepclaw/node-utils') | undefined,
    subscribe: vi.fn<(listener: (event: LoopGatewayEvent) => void) => () => void>(),
    unsubscribe: vi.fn<() => void>(),
    isLoopBusy: vi.fn<(loopId: string) => boolean>(),
    cancelInteraction: vi.fn<(browserId: string, loopId: string, reason: string) => void>(),
    disconnectBrowser: vi.fn<(browserId: string) => void>(),
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
            cancelInteraction: mocks.cancelInteraction,
            disconnectBrowser: mocks.disconnectBrowser,
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
    loopId: string | undefined;
    frames: string[];
    enqueue: Mock<(chunk: Uint8Array) => void>;
};

/** The server is a globalized singleton, so the global slot is dropped to give every test its own store. */
async function loadServer(): Promise<SSEServerType> {
    delete (globalThis as unknown as Record<string, unknown>)['__SSEServer'];
    vi.resetModules();
    return (await import('./sse-server')).SSEServer;
}

function addClient(server: SSEServerType, type: SSEType, browserId: string, loopId?: string): FakeClient {
    const frames: string[] = [];
    const decoder = new TextDecoder();
    const enqueue = vi.fn<(chunk: Uint8Array) => void>(chunk => {
        frames.push(decoder.decode(chunk));
    });
    const controller = {enqueue} as unknown as ReadableStreamDefaultController;
    server.addClient(type, browserId, loopId, controller, new TextEncoder());
    return {browserId, loopId, frames, enqueue};
}

function addInfoClient(server: SSEServerType, browserId: string): FakeClient {
    return addClient(server, 'info', browserId);
}

/** Drops the busy frame that every loop client is greeted with. */
function addLoopClient(server: SSEServerType, browserId: string, loopId: string): FakeClient {
    const client = addClient(server, 'loop', browserId, loopId);
    client.frames.length = 0;
    return client;
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
    server = await loadServer();
});

describe('addClient', () => {

    test('subscribes to the gateway for the first info client', () => {
        addInfoClient(server, 'b1');
        expect(mocks.subscribe).toHaveBeenCalledOnce();
    });

    test('keeps a single subscription for further info clients', () => {
        addInfoClient(server, 'b1');
        addInfoClient(server, 'b2');
        expect(mocks.subscribe).toHaveBeenCalledOnce();
    });

    test('does not subscribe for a loop client', () => {
        addClient(server, 'loop', 'b1', 'agent.a1');
        expect(mocks.subscribe).not.toHaveBeenCalled();
    });

    test('greets a loop client with the busy state of its loop', () => {
        mocks.isLoopBusy.mockReturnValue(true);
        const client = addClient(server, 'loop', 'b1', 'agent.a1');
        expect(mocks.isLoopBusy).toHaveBeenCalledWith('agent.a1');
        expect(received(client)).toEqual([{eventType: 'busy', loopId: 'agent.a1', content: '', busy: true}]);
    });

    test('greets a loop client of an idle loop as well', () => {
        const client = addClient(server, 'loop', 'b1', 'agent.a1');
        expect(received(client)).toEqual([{eventType: 'busy', loopId: 'agent.a1', content: '', busy: false}]);
    });

    test('says nothing to a new info client', () => {
        expect(addInfoClient(server, 'b1').frames).toEqual([]);
    });

    test('says nothing to a loop client that named no loop', () => {
        const client = addClient(server, 'loop', 'b1');
        expect(client.frames).toEqual([]);
        expect(mocks.isLoopBusy).not.toHaveBeenCalled();
    });

    test('replaces an earlier client of the same browser and loop', () => {
        addInfoClient(server, 'b1');
        const first = addLoopClient(server, 'b1', 'agent.a1');
        const second = addLoopClient(server, 'b1', 'agent.a1');
        fire(busyEvent('agent.a1'));
        expect(first.frames).toEqual([]);
        expect(received(second)).toHaveLength(1);
    });

    test('keeps the clients of two loops of the same browser apart', () => {
        addInfoClient(server, 'b1');
        const first = addLoopClient(server, 'b1', 'agent.a1');
        const second = addLoopClient(server, 'b1', 'agent.a2');
        fire(busyEvent('agent.a1'));
        expect(received(first)).toHaveLength(1);
        expect(second.frames).toEqual([]);
    });
});

describe('info events', () => {

    test('sends an agent update to every info client', () => {
        const first = addInfoClient(server, 'b1');
        const second = addInfoClient(server, 'b2');
        fire({eventType: 'updateAgent', content: {id: 'a1'}});
        expect(received(first)).toEqual([{eventType: 'updateAgent', content: {id: 'a1'}}]);
        expect(received(second)).toEqual([{eventType: 'updateAgent', content: {id: 'a1'}}]);
    });

    test('names the event type in the frame header', () => {
        const client = addInfoClient(server, 'b1');
        fire({eventType: 'updateProject', content: {id: 'p1'}});
        expect(eventTypes(client)).toEqual(['updateProject']);
    });

    test('sends a cron update as an info event', () => {
        const client = addInfoClient(server, 'b1');
        fire({eventType: 'updateCron', content: {id: 'c1'}});
        expect(received(client)).toEqual([{eventType: 'updateCron', content: {id: 'c1'}}]);
    });

    test('does not send an info event to loop clients', () => {
        addInfoClient(server, 'b1');
        const loopClient = addLoopClient(server, 'b1', 'agent.a1');
        fire({eventType: 'updateAgent', content: {id: 'a1'}});
        expect(loopClient.frames).toEqual([]);
    });

    test('ignores an event that is neither an info nor a loop event', () => {
        const client = addInfoClient(server, 'b1');
        fire({eventType: 'connected', content: 'b1'});
        expect(client.frames).toEqual([]);
    });
});

describe('loop events', () => {

    test('sends a busy event to every loop client of that loop', () => {
        addInfoClient(server, 'b1');
        addInfoClient(server, 'b2');
        const first = addLoopClient(server, 'b1', 'agent.a1');
        const second = addLoopClient(server, 'b2', 'agent.a1');
        fire(busyEvent('agent.a1'));
        expect(received(first)).toEqual([{eventType: 'busy', loopId: 'agent.a1', busy: true}]);
        expect(received(second)).toHaveLength(1);
    });

    test('skips the loop clients of another loop', () => {
        addInfoClient(server, 'b1');
        const other = addLoopClient(server, 'b1', 'agent.a2');
        fire(busyEvent('agent.a1'));
        expect(other.frames).toEqual([]);
    });

    test('drops a loop event when the browser has no info client', () => {
        const client = addLoopClient(server, 'b1', 'agent.a1');
        addInfoClient(server, 'b2');
        fire(busyEvent('agent.a1'));
        expect(client.frames).toEqual([]);
    });

    test('sends a token usage event to the loop clients of that loop', () => {
        addInfoClient(server, 'b1');
        const client = addLoopClient(server, 'b1', 'agent.a1');
        const usage = {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3};
        fire({eventType: 'tokenUsage', loopId: 'agent.a1', usage} as SSEEvent);
        expect(received(client)).toEqual([{eventType: 'tokenUsage', loopId: 'agent.a1', usage}]);
    });

    test('sends a chat event to the other browsers watching the loop', () => {
        addInfoClient(server, 'b1');
        addInfoClient(server, 'b2');
        const author = addLoopClient(server, 'b1', 'agent.a1');
        const listener = addLoopClient(server, 'b2', 'agent.a1');
        fire({eventType: 'chat', loopId: 'agent.a1', browserId: 'b1', update: false, message: {id: 'm1'}} as SSEEvent);
        expect(author.frames).toEqual([]);
        expect(received(listener)).toHaveLength(1);
    });

    test('sends a stream event only to the browser it belongs to', () => {
        addInfoClient(server, 'b1');
        addInfoClient(server, 'b2');
        const owner = addLoopClient(server, 'b1', 'agent.a1');
        const other = addLoopClient(server, 'b2', 'agent.a1');
        fire(streamEvent('b1', 'agent.a1'));
        expect(received(owner)).toHaveLength(1);
        expect(other.frames).toEqual([]);
    });

    test('sends a stream event of another loop of the same browser nowhere', () => {
        addInfoClient(server, 'b1');
        const client = addLoopClient(server, 'b1', 'agent.a1');
        fire(streamEvent('b1', 'agent.a2'));
        expect(client.frames).toEqual([]);
    });

    test('sends an interaction event to the active client of that browser and loop', () => {
        addInfoClient(server, 'b1');
        const client = addLoopClient(server, 'b1', 'agent.a1');
        fire(interactionEvent('b1', 'agent.a1'));
        expect(eventTypes(client)).toEqual(['interaction']);
        expect(mocks.cancelInteraction).not.toHaveBeenCalled();
    });

    test('sends a cancel interaction event to the active client', () => {
        addInfoClient(server, 'b1');
        const client = addLoopClient(server, 'b1', 'agent.a1');
        fire({eventType: 'cancelInteraction', loopId: 'agent.a1', browserId: 'b1'} as SSEEvent);
        expect(received(client)).toEqual([{eventType: 'cancelInteraction', loopId: 'agent.a1', browserId: 'b1'}]);
    });

    test('skips an inactive client for a cancel interaction event', () => {
        addInfoClient(server, 'b1');
        const client = addLoopClient(server, 'b1', 'agent.a1');
        server.activeClient('b1', 'agent.a1', false);
        fire({eventType: 'cancelInteraction', loopId: 'agent.a1', browserId: 'b1'} as SSEEvent);
        expect(client.frames).toEqual([]);
    });

    test('still sends a busy event to an inactive client', () => {
        addInfoClient(server, 'b1');
        const client = addLoopClient(server, 'b1', 'agent.a1');
        server.activeClient('b1', 'agent.a1', false);
        fire(busyEvent('agent.a1'));
        expect(received(client)).toHaveLength(1);
    });
});

describe('interactions nobody listens to', () => {

    test('parks the interaction and toasts the browser that is still connected', () => {
        const infoClient = addInfoClient(server, 'b1');
        fire(interactionEvent('b1', 'agent.a1'));
        expect(mocks.cancelInteraction).toHaveBeenCalledWith('b1', 'agent.a1', 'interactionAfk');
        expect(received(infoClient)).toEqual([
            {eventType: 'toast', content: {key: 'interactionPause', data: 'agent.a1'}},
        ]);
    });

    test('parks the interaction when the loop client turned inactive', () => {
        const infoClient = addInfoClient(server, 'b1');
        const loopClient = addLoopClient(server, 'b1', 'agent.a1');
        server.activeClient('b1', 'agent.a1', false);
        fire(interactionEvent('b1', 'agent.a1'));
        expect(loopClient.frames).toEqual([]);
        expect(mocks.cancelInteraction).toHaveBeenCalledWith('b1', 'agent.a1', 'interactionAfk');
        expect(eventTypes(infoClient)).toEqual(['toast']);
    });

    test('cancels the interaction of a browser that left completely', () => {
        addInfoClient(server, 'b2');
        fire(interactionEvent('b1', 'agent.a1'));
        expect(mocks.cancelInteraction).toHaveBeenCalledWith('b1', 'agent.a1', 'disconnected');
    });

    test('leaves other loop events alone when nobody listens', () => {
        addInfoClient(server, 'b1');
        fire(busyEvent('agent.a1'));
        expect(mocks.cancelInteraction).not.toHaveBeenCalled();
    });
});

describe('a client whose stream is gone', () => {

    function breakClient(client: FakeClient): void {
        client.enqueue.mockImplementation(() => {
            throw new Error('stream closed');
        });
    }

    test('drops the loop client and cancels the interaction it was waiting for', () => {
        addInfoClient(server, 'b1');
        const client = addLoopClient(server, 'b1', 'agent.a1');
        breakClient(client);
        fire(busyEvent('agent.a1'));
        expect(mocks.cancelInteraction).toHaveBeenCalledWith('b1', 'agent.a1', 'error');
        client.enqueue.mockClear();
        fire(busyEvent('agent.a1'));
        expect(client.enqueue).not.toHaveBeenCalled();
    });

    test('logs the browser and the stream type it failed on', () => {
        addInfoClient(server, 'b1');
        const client = addLoopClient(server, 'b1', 'agent.a1');
        breakClient(client);
        fire(busyEvent('agent.a1'));
        expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('Failed to send to client b1 for loop'));
    });

    test('drops a failing info client without cancelling an interaction', () => {
        const client = addInfoClient(server, 'b1');
        breakClient(client);
        fire({eventType: 'updateAgent', content: {id: 'a1'}});
        expect(mocks.disconnectBrowser).toHaveBeenCalledWith('b1');
        expect(mocks.cancelInteraction).not.toHaveBeenCalled();
    });

    test('keeps serving the clients that are still alive', () => {
        addInfoClient(server, 'b1');
        addInfoClient(server, 'b2');
        const broken = addLoopClient(server, 'b1', 'agent.a1');
        const healthy = addLoopClient(server, 'b2', 'agent.a1');
        breakClient(broken);
        fire(busyEvent('agent.a1'));
        expect(received(healthy)).toHaveLength(1);
    });
});

describe('removeClient', () => {

    test('disconnects the browser when its info client leaves', () => {
        addInfoClient(server, 'b1');
        server.removeClient('info', 'b1');
        expect(mocks.disconnectBrowser).toHaveBeenCalledWith('b1');
    });

    test('unsubscribes from the gateway once the last info client left', () => {
        addInfoClient(server, 'b1');
        server.removeClient('info', 'b1');
        expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    });

    test('keeps the subscription while another info client stays', () => {
        addInfoClient(server, 'b1');
        addInfoClient(server, 'b2');
        server.removeClient('info', 'b1');
        expect(mocks.unsubscribe).not.toHaveBeenCalled();
    });

    test('subscribes again when an info client comes back', () => {
        addInfoClient(server, 'b1');
        server.removeClient('info', 'b1');
        addInfoClient(server, 'b1');
        expect(mocks.subscribe).toHaveBeenCalledTimes(2);
    });

    test('does not disconnect the browser when only a loop client leaves', () => {
        addInfoClient(server, 'b1');
        addLoopClient(server, 'b1', 'agent.a1');
        server.removeClient('loop', 'b1', 'agent.a1');
        expect(mocks.disconnectBrowser).not.toHaveBeenCalled();
        expect(mocks.unsubscribe).not.toHaveBeenCalled();
    });

    test('stops sending to a client that left', () => {
        addInfoClient(server, 'b1');
        const client = addLoopClient(server, 'b1', 'agent.a1');
        server.removeClient('loop', 'b1', 'agent.a1');
        fire(busyEvent('agent.a1'));
        expect(client.frames).toEqual([]);
    });

    test('drops the loop events of a browser whose info client left', () => {
        addInfoClient(server, 'b1');
        const client = addLoopClient(server, 'b1', 'agent.a1');
        const listener = mocks.subscribe.mock.calls[0]![0];
        server.removeClient('info', 'b1');
        listener(busyEvent('agent.a1') as LoopGatewayEvent);
        expect(client.frames).toEqual([]);
    });

    test('accepts a client that was never registered', () => {
        addInfoClient(server, 'b1');
        expect(() => server.removeClient('loop', 'ghost', 'agent.a1')).not.toThrow();
        expect(mocks.disconnectBrowser).not.toHaveBeenCalled();
    });
});

describe('activeClient', () => {

    test('deactivates the loop client of that browser and loop', () => {
        addInfoClient(server, 'b1');
        const client = addLoopClient(server, 'b1', 'agent.a1');
        server.activeClient('b1', 'agent.a1', false);
        fire(interactionEvent('b1', 'agent.a1'));
        expect(client.frames).toEqual([]);
    });

    test('activates the client again', () => {
        addInfoClient(server, 'b1');
        const client = addLoopClient(server, 'b1', 'agent.a1');
        server.activeClient('b1', 'agent.a1', false);
        server.activeClient('b1', 'agent.a1', true);
        fire(interactionEvent('b1', 'agent.a1'));
        expect(eventTypes(client)).toEqual(['interaction']);
    });

    test('leaves the client of another browser untouched', () => {
        addInfoClient(server, 'b1');
        addInfoClient(server, 'b2');
        const other = addLoopClient(server, 'b2', 'agent.a1');
        server.activeClient('b1', 'agent.a1', false);
        fire(interactionEvent('b2', 'agent.a1'));
        expect(eventTypes(other)).toEqual(['interaction']);
    });

    test('leaves the client of another loop untouched', () => {
        addInfoClient(server, 'b1');
        const other = addLoopClient(server, 'b1', 'agent.a2');
        server.activeClient('b1', 'agent.a1', false);
        fire(interactionEvent('b1', 'agent.a2'));
        expect(eventTypes(other)).toEqual(['interaction']);
    });

    test('ignores a loop nobody watches', () => {
        addInfoClient(server, 'b1');
        expect(() => server.activeClient('b1', 'agent.ghost', false)).not.toThrow();
    });
});
