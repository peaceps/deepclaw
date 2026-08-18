import {afterEach, beforeEach, describe, expect, test, vi, type Mock} from 'vitest';
import {SSEClient, sseClient, type SSEHandler} from './sse-client';

const mocks = vi.hoisted(() => ({
    error: vi.fn<(payload: unknown, message: string) => void>(),
}));

vi.mock('@/lib/logger', () => ({
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.error}),
}));

let sources: FakeEventSource[] = [];

class FakeEventSource {
    public static readonly CONNECTING = 0;
    public static readonly OPEN = 1;
    public static readonly CLOSED = 2;

    public readyState: number = FakeEventSource.OPEN;
    public onerror: ((event: Event) => void) | null = null;
    public closeCount = 0;

    private readonly listeners = new Map<string, EventListener[]>();

    constructor(public readonly url: string) {
        sources.push(this);
    }

    public addEventListener(eventName: string, listener: EventListener): void {
        this.listeners.set(eventName, [...(this.listeners.get(eventName) ?? []), listener]);
    }

    public removeEventListener(eventName: string, listener: EventListener): void {
        this.listeners.set(eventName, (this.listeners.get(eventName) ?? []).filter(item => item !== listener));
    }

    public close(): void {
        this.closeCount += 1;
        this.readyState = FakeEventSource.CLOSED;
    }

    public listenerCount(eventName: string): number {
        return (this.listeners.get(eventName) ?? []).length;
    }

    public emit(eventName: string, data: string): void {
        for (const listener of [...(this.listeners.get(eventName) ?? [])]) {
            listener({type: eventName, data} as unknown as Event);
        }
    }
}

function lastSource(): FakeEventSource {
    return sources[sources.length - 1];
}

function newHandler<T = unknown>(): Mock<SSEHandler<T>> {
    return vi.fn<SSEHandler<T>>();
}

describe('SSEClient', () => {

    let client: SSEClient;

    beforeEach(() => {
        vi.clearAllMocks();
        sources = [];
        vi.stubGlobal('EventSource', FakeEventSource);
        client = new SSEClient();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('subscribe', () => {

        test('opens one connection for the url', () => {
            client.subscribe('/api/sse', 'chat', newHandler());
            expect(sources).toHaveLength(1);
            expect(lastSource().url).toBe('/api/sse');
        });

        test('shares one connection between subscribers of the same url', () => {
            client.subscribe('/api/sse', 'chat', newHandler());
            client.subscribe('/api/sse', 'busy', newHandler());
            expect(sources).toHaveLength(1);
        });

        test('opens a separate connection per url', () => {
            client.subscribe('/api/sse/info', 'chat', newHandler());
            client.subscribe('/api/sse/loop', 'chat', newHandler());
            expect(sources).toHaveLength(2);
        });

        test('hands the parsed payload to the handler', () => {
            const handler = newHandler<{text: string}>();
            client.subscribe('/api/sse', 'chat', handler);
            lastSource().emit('chat', JSON.stringify({text: 'hi'}));
            expect(handler).toHaveBeenCalledWith({text: 'hi'}, expect.objectContaining({data: '{"text":"hi"}'}));
        });

        test('hands over the raw text when the payload is not json', () => {
            const handler = newHandler<string>();
            client.subscribe('/api/sse', 'connected', handler);
            lastSource().emit('connected', 'browser-1');
            expect(handler).toHaveBeenCalledWith('browser-1', expect.anything());
        });

        test('only reacts to the event name it subscribed to', () => {
            const handler = newHandler();
            client.subscribe('/api/sse', 'chat', handler);
            lastSource().emit('busy', '{}');
            expect(handler).not.toHaveBeenCalled();
        });

        test('delivers every event to every subscriber of the name', () => {
            const first = newHandler();
            const second = newHandler();
            client.subscribe('/api/sse', 'chat', first);
            client.subscribe('/api/sse', 'chat', second);
            lastSource().emit('chat', '{}');
            expect(first).toHaveBeenCalledOnce();
            expect(second).toHaveBeenCalledOnce();
        });

        test('stops delivering and closes the connection on unsubscribe', () => {
            const handler = newHandler();
            const unsubscribe = client.subscribe('/api/sse', 'chat', handler);
            const source = lastSource();
            unsubscribe();
            source.emit('chat', '{}');
            expect(handler).not.toHaveBeenCalled();
            expect(source.closeCount).toBe(1);
            expect(source.listenerCount('chat')).toBe(0);
        });

        test('keeps the connection while another subscriber is left', () => {
            const unsubscribe = client.subscribe('/api/sse', 'chat', newHandler());
            client.subscribe('/api/sse', 'busy', newHandler());
            unsubscribe();
            expect(lastSource().closeCount).toBe(0);
        });

        test('closes the connection once the last subscriber left', () => {
            const first = client.subscribe('/api/sse', 'chat', newHandler());
            const second = client.subscribe('/api/sse', 'busy', newHandler());
            first();
            second();
            expect(lastSource().closeCount).toBe(1);
        });

        test('ignores a second unsubscribe', () => {
            const unsubscribe = client.subscribe('/api/sse', 'chat', newHandler());
            client.subscribe('/api/sse', 'busy', newHandler());
            unsubscribe();
            unsubscribe();
            expect(lastSource().closeCount).toBe(0);
        });

        test('does not close a connection that was already replaced', () => {
            const unsubscribe = client.subscribe('/api/sse', 'chat', newHandler());
            const first = lastSource();
            client.close('/api/sse');
            client.subscribe('/api/sse', 'chat', newHandler());
            unsubscribe();
            expect(first.closeCount).toBe(1);
            expect(lastSource().closeCount).toBe(0);
        });

        test('opens a fresh connection when the previous source is closed', () => {
            client.subscribe('/api/sse', 'chat', newHandler());
            lastSource().readyState = FakeEventSource.CLOSED;
            client.subscribe('/api/sse', 'busy', newHandler());
            expect(sources).toHaveLength(2);
        });

        test('reuses a connection that is still connecting', () => {
            client.subscribe('/api/sse', 'chat', newHandler());
            lastSource().readyState = FakeEventSource.CONNECTING;
            client.subscribe('/api/sse', 'busy', newHandler());
            expect(sources).toHaveLength(1);
        });
    });

    describe('subscribePersistent', () => {

        test('delivers the parsed payload', () => {
            const handler = newHandler<{text: string}>();
            client.subscribePersistent('/api/sse', 'chat', handler);
            lastSource().emit('chat', JSON.stringify({text: 'hi'}));
            expect(handler).toHaveBeenCalledWith({text: 'hi'}, expect.anything());
        });

        test('registers only one listener per event name', () => {
            const second = newHandler();
            client.subscribePersistent('/api/sse', 'chat', newHandler());
            client.subscribePersistent('/api/sse', 'chat', second);
            lastSource().emit('chat', '{}');
            expect(second).not.toHaveBeenCalled();
            expect(lastSource().listenerCount('chat')).toBe(1);
        });

        test('keeps a listener per key when the connection is shared', () => {
            const first = newHandler();
            const second = newHandler();
            client.subscribePersistent('/api/sse', 'chat', first, {key: 'agent.a1'});
            client.subscribePersistent('/api/sse', 'chat', second, {key: 'agent.a2'});
            lastSource().emit('chat', '{}');
            expect(first).toHaveBeenCalledOnce();
            expect(second).toHaveBeenCalledOnce();
        });

        test('turns down a duplicate of the same key', () => {
            const second = newHandler();
            client.subscribePersistent('/api/sse', 'chat', newHandler(), {key: 'agent.a1'});
            client.subscribePersistent('/api/sse', 'chat', second, {key: 'agent.a1'});
            lastSource().emit('chat', '{}');
            expect(second).not.toHaveBeenCalled();
        });

        test('returns a dead unsubscribe for the rejected duplicate', () => {
            const first = newHandler();
            client.subscribePersistent('/api/sse', 'chat', first);
            client.subscribePersistent('/api/sse', 'chat', newHandler())();
            lastSource().emit('chat', '{}');
            expect(first).toHaveBeenCalledOnce();
        });

        test('keeps listening while removeOn stays false', () => {
            const handler = newHandler<{done: boolean}>();
            client.subscribePersistent('/api/sse', 'chat', handler, {removeOn: data => data.done});
            lastSource().emit('chat', JSON.stringify({done: false}));
            lastSource().emit('chat', JSON.stringify({done: false}));
            expect(handler).toHaveBeenCalledTimes(2);
        });

        test('removes itself once removeOn is true', () => {
            const handler = newHandler<{done: boolean}>();
            client.subscribePersistent('/api/sse', 'chat', handler, {removeOn: data => data.done});
            const source = lastSource();
            source.emit('chat', JSON.stringify({done: true}));
            source.emit('chat', JSON.stringify({done: false}));
            expect(handler).toHaveBeenCalledOnce();
            expect(source.closeCount).toBe(1);
        });

        test('handles the event before removeOn ends the subscription', () => {
            const handler = newHandler<{done: boolean}>();
            client.subscribePersistent('/api/sse', 'chat', handler, {removeOn: () => true});
            lastSource().emit('chat', JSON.stringify({done: true}));
            expect(handler).toHaveBeenCalledWith({done: true}, expect.anything());
        });

        test('closes the connection on unsubscribe', () => {
            client.subscribePersistent('/api/sse', 'chat', newHandler())();
            expect(lastSource().closeCount).toBe(1);
            expect(lastSource().listenerCount('chat')).toBe(0);
        });

        test('keeps the connection alive for an ordinary subscriber', () => {
            client.subscribe('/api/sse', 'busy', newHandler());
            client.subscribePersistent('/api/sse', 'chat', newHandler())();
            expect(lastSource().closeCount).toBe(0);
        });

        test('can register the event name again after it was removed', () => {
            client.subscribePersistent('/api/sse', 'chat', newHandler())();
            const handler = newHandler();
            client.subscribePersistent('/api/sse', 'chat', handler);
            lastSource().emit('chat', '{}');
            expect(handler).toHaveBeenCalledOnce();
        });

        test('ignores a second unsubscribe', () => {
            client.subscribe('/api/sse', 'busy', newHandler());
            const unsubscribe = client.subscribePersistent('/api/sse', 'chat', newHandler());
            unsubscribe();
            unsubscribe();
            expect(lastSource().closeCount).toBe(0);
        });
    });

    describe('close', () => {

        test('closes the source and forgets the url', () => {
            client.subscribe('/api/sse', 'chat', newHandler());
            const source = lastSource();
            client.close('/api/sse');
            client.subscribe('/api/sse', 'chat', newHandler());
            expect(source.closeCount).toBe(1);
            expect(sources).toHaveLength(2);
        });

        test('does nothing for an unknown url', () => {
            expect(() => client.close('/api/ghost')).not.toThrow();
        });

        test('closes every connection at once', () => {
            client.subscribe('/api/sse/info', 'chat', newHandler());
            client.subscribe('/api/sse/loop', 'chat', newHandler());
            client.closeAll();
            expect(sources.map(source => source.closeCount)).toEqual([1, 1]);
        });

        test('leaves nothing behind after closeAll', () => {
            client.subscribe('/api/sse', 'chat', newHandler());
            client.closeAll();
            client.closeAll();
            expect(lastSource().closeCount).toBe(1);
        });
    });

    describe('connection errors', () => {

        test('logs an error reported by the source', () => {
            client.subscribe('/api/sse', 'chat', newHandler());
            const event = {type: 'error'} as Event;
            lastSource().onerror?.(event);
            expect(mocks.error).toHaveBeenCalledWith({url: '/api/sse', event}, 'SSE connection error');
        });

        test('keeps the connection so the browser can reconnect on its own', () => {
            client.subscribe('/api/sse', 'chat', newHandler());
            const source = lastSource();
            source.onerror?.({type: 'error'} as Event);
            expect(source.closeCount).toBe(0);
        });
    });

    describe('sseClient', () => {

        test('is a shared instance', () => {
            expect(sseClient).toBeInstanceOf(SSEClient);
        });
    });
});
