import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentInteractionEvent, type ImageContent} from '@deepclaw/core';
import {IMMessageHandler, type ParsedMessage} from './im-message-handler';

type InvokeResult = {busy: boolean; msgId: string};
type AgentHandler = {onInteractionEvent: (event: AgentInteractionEvent) => Promise<string>};

const mocks = vi.hoisted(() => ({
    isCurrentConfigValid: vi.fn<() => boolean>(),
    isLoopBusy: vi.fn<(loopId: string) => boolean>(),
    addMessage: vi.fn<(browserId: string, loopId: string, message: unknown) => void>(),
    invoke: vi.fn<(...args: unknown[]) => InvokeResult>(),
    error: vi.fn<(message: string) => void>(),
}));

vi.mock('@deepclaw/config', () => ({isCurrentConfigValid: mocks.isCurrentConfigValid}));

vi.mock('@deepclaw/i18n', () => ({i18nInstance: {t: (key: string) => key}}));

vi.mock('@deepclaw/loop-gateway', () => ({
    LoopGateway: {
        isLoopBusy: mocks.isLoopBusy,
        addMessage: mocks.addMessage,
        invoke: mocks.invoke,
    },
}));

vi.mock('@deepclaw/node-utils', () => ({
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.error}),
}));

type RawEvent = {
    id: string;
    text: string;
    unparsable?: boolean;
    fetchImages?: () => Promise<ImageContent[] | undefined>;
};

/** Stands in for a real engine: every message answers to a target of its own. */
class TestHandler extends IMMessageHandler<RawEvent, string> {
    public readonly acked: string[] = [];
    public readonly sent: string[] = [];
    public readonly sentTo: string[] = [];

    protected override preHandleMessage(event: RawEvent): void {
        this.acked.push(event.id);
    }

    protected override parseMessage(event: RawEvent): ParsedMessage<string> | null {
        return event.unparsable ? null : {
            id: event.id, text: event.text, body: `to-${event.id}`, fetchImages: event.fetchImages,
        };
    }

    protected override _sendMessage(target: string, content: string): void {
        this.sentTo.push(target);
        this.sent.push(content);
    }
}

/** The handler queues the agent call on a promise chain, so the microtasks have to be drained. */
function flush(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function interactionEvent(overrides: Partial<AgentInteractionEvent> = {}): AgentInteractionEvent {
    return {
        eventType: 'interaction',
        loopId: 'agent.a1',
        browserId: 'b1',
        type: 'input',
        content: 'your name?',
        ...overrides,
    } as AgentInteractionEvent;
}

function selectEvent(): AgentInteractionEvent {
    return interactionEvent({
        type: 'select',
        content: 'pick one',
        options: [{label: 'the first', value: 'first'}, {label: 'the second', value: 'second'}],
    } as Partial<AgentInteractionEvent>);
}

function agentHandler(call = 0): AgentHandler {
    return mocks.invoke.mock.calls[call]![3] as AgentHandler;
}

function onDone(call = 0): (text: string) => void {
    return mocks.invoke.mock.calls[call]![4] as (text: string) => void;
}

function imagesOf(call = 0): ImageContent[] | undefined {
    return (mocks.invoke.mock.calls[call]![1] as {images?: ImageContent[]}).images;
}

function deferred<T>(): {promise: Promise<T>; resolve: (value: T) => void; reject: (e: Error) => void} {
    let resolve!: (value: T) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return {promise, resolve, reject};
}

let handler: TestHandler;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.isCurrentConfigValid.mockReturnValue(true);
    mocks.isLoopBusy.mockReturnValue(false);
    mocks.invoke.mockReturnValue({busy: false, msgId: 'msg-1'});
    handler = new TestHandler('a1');
});

describe('accepting a message', () => {

    test('answers the transport before looking at the payload', () => {
        handler.onMessage({id: 'm1', text: 'hi', unparsable: true});
        expect(handler.acked).toEqual(['m1']);
    });

    test('drops an event it cannot parse', async () => {
        handler.onMessage({id: 'm1', text: 'hi', unparsable: true});
        await flush();
        expect(mocks.invoke).not.toHaveBeenCalled();
        expect(handler.sent).toEqual([]);
    });

    test('survives an engine that throws while parsing', () => {
        vi.spyOn(handler as unknown as {parseMessage: () => never}, 'parseMessage')
            .mockImplementation(() => {
                throw new Error('bad payload');
            });
        expect(() => handler.onMessage({id: 'm1', text: 'hi'})).not.toThrow();
        expect(mocks.error).toHaveBeenCalled();
    });

    test('handles the same message only once', async () => {
        handler.onMessage({id: 'm1', text: 'hi'});
        handler.onMessage({id: 'm1', text: 'hi'});
        await flush();
        expect(mocks.invoke).toHaveBeenCalledOnce();
    });

    test('answers the transport again for a redelivery', () => {
        handler.onMessage({id: 'm1', text: 'hi'});
        handler.onMessage({id: 'm1', text: 'hi'});
        expect(handler.acked).toEqual(['m1', 'm1']);
    });

    test('takes the message again once the dedup window passed', async () => {
        vi.useFakeTimers();
        try {
            handler.onMessage({id: 'm1', text: 'hi'});
            await vi.advanceTimersByTimeAsync(3 * 60 * 1000 + 1);
            handler.onMessage({id: 'm1', text: 'hi'});
            await vi.advanceTimersByTimeAsync(0);
        } finally {
            vi.useRealTimers();
        }
        expect(mocks.invoke).toHaveBeenCalledTimes(2);
    });
});

describe('turning a message into a run', () => {

    test('puts the message into the chat of the agent', async () => {
        handler.onMessage({id: 'm1', text: 'hi'});
        await flush();
        expect(mocks.addMessage).toHaveBeenCalledWith(
            '', 'agent.a1', expect.objectContaining({content: '📱 hi', type: 'user', agentId: 'a1'}),
        );
    });

    test('asks the sender to wait before the agent starts', async () => {
        handler.onMessage({id: 'm1', text: 'hi'});
        await flush();
        expect(handler.sent[0]).toBe('im.wait');
    });

    test('runs the agent with the text of the message', async () => {
        handler.onMessage({id: 'm1', text: 'hi'});
        await flush();
        expect(mocks.invoke.mock.calls[0]![0]).toEqual({role: 'agent', agentId: 'a1', projectId: ''});
        expect(mocks.invoke.mock.calls[0]![2]).toBe('hi');
    });

    test('marks the run as coming from im', async () => {
        handler.onMessage({id: 'm1', text: 'hi'});
        await flush();
        expect(mocks.invoke.mock.calls[0]![1]).toEqual(expect.objectContaining({source: 'im'}));
    });

    test('sends the answer of the agent back', async () => {
        handler.onMessage({id: 'm1', text: 'hi'});
        await flush();
        onDone()('the answer');
        expect(handler.sent).toContain('the answer');
        expect(handler.sentTo).toEqual(['to-m1', 'to-m1']);
    });

    test('closes the message once the agent has answered', async () => {
        handler.onMessage({id: 'm1', text: 'hi'});
        await flush();
        onDone()('the answer');
        onDone()('a late extra');
        expect(handler.sent).toEqual(['im.wait', 'the answer']);
    });

    test('runs the messages in the order they arrived', async () => {
        handler.onMessage({id: 'm1', text: 'first'});
        handler.onMessage({id: 'm2', text: 'second'});
        await flush();
        expect(mocks.invoke.mock.calls.map(call => call[2])).toEqual(['first', 'second']);
    });
});

describe('carrying images', () => {

    const picture: ImageContent = {url: 'data:image/png;base64,AAA', mediaType: 'image/png'};

    test('runs the agent without images when the message has none', async () => {
        handler.onMessage({id: 'm1', text: 'hi'});
        await flush();
        expect(imagesOf()).toBeUndefined();
    });

    test('hands the images of the message to the run', async () => {
        handler.onMessage({id: 'm1', text: 'hi', fetchImages: () => Promise.resolve([picture])});
        await flush();
        expect(imagesOf()).toEqual([picture]);
    });

    test('puts the images into the chat of the agent', async () => {
        handler.onMessage({id: 'm1', text: 'hi', fetchImages: () => Promise.resolve([picture])});
        await flush();
        expect(mocks.addMessage).toHaveBeenCalledWith(
            '', 'agent.a1', expect.objectContaining({images: [picture]}),
        );
    });

    test('asks the sender to wait before the images are downloaded', async () => {
        const download = deferred<ImageContent[] | undefined>();
        handler.onMessage({id: 'm1', text: 'hi', fetchImages: () => download.promise});
        await flush();
        expect(handler.sent).toEqual(['im.wait']);
        expect(mocks.invoke).not.toHaveBeenCalled();
        download.resolve([picture]);
    });

    test('ignores a redelivery while the images are still downloading', async () => {
        const download = deferred<ImageContent[] | undefined>();
        handler.onMessage({id: 'm1', text: 'hi', fetchImages: () => download.promise});
        handler.onMessage({id: 'm1', text: 'hi', fetchImages: () => download.promise});
        download.resolve([picture]);
        await flush();
        expect(mocks.invoke).toHaveBeenCalledOnce();
    });

    test('keeps the arrival order when a download is slow', async () => {
        const download = deferred<ImageContent[] | undefined>();
        handler.onMessage({id: 'm1', text: 'first', fetchImages: () => download.promise});
        handler.onMessage({id: 'm2', text: 'second'});
        await flush();
        download.resolve([picture]);
        await flush();
        expect(mocks.invoke.mock.calls.map(call => call[2])).toEqual(['first', 'second']);
    });

    test('reports a download that failed', async () => {
        handler.onMessage({
            id: 'm1', text: 'hi', fetchImages: () => Promise.reject(new Error('no network')),
        });
        await flush();
        expect(handler.sent[1]).toBe('im.error: no network');
    });
});

describe('refusing a message', () => {

    test('tells the sender that the config is broken', async () => {
        mocks.isCurrentConfigValid.mockReturnValue(false);
        handler.onMessage({id: 'm1', text: 'hi'});
        await flush();
        expect(handler.sent).toEqual(['im.invalidConfig']);
        expect(mocks.invoke).not.toHaveBeenCalled();
    });

    test('tells the sender that the agent is busy', async () => {
        mocks.isLoopBusy.mockReturnValue(true);
        handler.onMessage({id: 'm1', text: 'hi'});
        await flush();
        expect(handler.sent).toEqual(['im.busy']);
        expect(mocks.invoke).not.toHaveBeenCalled();
    });

    test('answers a busy sender without disturbing the running message', async () => {
        handler.onMessage({id: 'm1', text: 'hi'});
        await flush();
        mocks.isLoopBusy.mockReturnValue(true);
        handler.onMessage({id: 'm2', text: 'and this'});
        await flush();
        onDone()('the answer');
        expect(handler.sent).toEqual(['im.wait', 'im.busy', 'the answer']);
        expect(handler.sentTo).toEqual(['to-m1', 'to-m2', 'to-m1']);
    });

    test('tells the sender when the run itself came back busy', async () => {
        mocks.invoke.mockReturnValue({busy: true, msgId: 'msg-1'});
        handler.onMessage({id: 'm1', text: 'hi'});
        await flush();
        expect(handler.sent).toEqual(['im.wait', 'im.busy']);
    });

    test('reports a run that blew up', async () => {
        mocks.invoke.mockImplementation(() => {
            throw new Error('no llm');
        });
        handler.onMessage({id: 'm1', text: 'hi'});
        await flush();
        expect(handler.sent[1]).toBe('im.error: no llm');
    });

    test('keeps taking messages after a failed run', async () => {
        mocks.invoke.mockImplementationOnce(() => {
            throw new Error('no llm');
        });
        handler.onMessage({id: 'm1', text: 'hi'});
        await flush();
        handler.onMessage({id: 'm2', text: 'again'});
        await flush();
        expect(mocks.invoke).toHaveBeenCalledTimes(2);
    });
});

describe('interacting through the chat', () => {

    beforeEach(async () => {
        handler.onMessage({id: 'm1', text: 'hi'});
        await flush();
    });

    test('asks the question of the agent in the chat', async () => {
        void agentHandler().onInteractionEvent(interactionEvent());
        await flush();
        expect(handler.sent).toContain('your name? ');
    });

    test('answers the question with the next message', async () => {
        const answer = agentHandler().onInteractionEvent(interactionEvent());
        await flush();
        handler.onMessage({id: 'm2', text: 'Ada'});
        await expect(answer).resolves.toBe('Ada');
    });

    test('does not start a second run for an answer', async () => {
        void agentHandler().onInteractionEvent(interactionEvent());
        await flush();
        handler.onMessage({id: 'm2', text: 'Ada'});
        await flush();
        expect(mocks.invoke).toHaveBeenCalledOnce();
        expect(mocks.addMessage).toHaveBeenCalledOnce();
    });

    test('keeps talking to the message that started the run', async () => {
        void agentHandler().onInteractionEvent(interactionEvent());
        await flush();
        handler.onMessage({id: 'm2', text: 'Ada'});
        await flush();
        expect(new Set(handler.sentTo)).toEqual(new Set(['to-m1']));
    });

    test('resolves a readonly interaction without waiting for an answer', async () => {
        const answer = agentHandler().onInteractionEvent(interactionEvent({type: 'readonly'}));
        await expect(answer).resolves.toBe('');
        expect(handler.sent).toContain('your name?');
    });

    test('turns the picked option into its value', async () => {
        const answer = agentHandler().onInteractionEvent(selectEvent());
        await flush();
        handler.onMessage({id: 'm2', text: '2'});
        await expect(answer).resolves.toBe('second');
    });

    test('asks again when the pick is out of range', async () => {
        const answer = agentHandler().onInteractionEvent(selectEvent());
        await flush();
        handler.onMessage({id: 'm2', text: '9'});
        await flush();
        expect(handler.sent).toContain('im.invalidSelection');

        handler.onMessage({id: 'm3', text: '1'});
        await expect(answer).resolves.toBe('first');
    });
});

afterEach(() => {
    vi.useRealTimers();
});
