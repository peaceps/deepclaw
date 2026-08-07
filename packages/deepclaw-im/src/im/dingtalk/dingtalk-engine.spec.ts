import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {DWClientDownStream} from 'dingtalk-stream';
import {dingTalk} from './dingtalk-engine';

const mocks = vi.hoisted(() => ({
    client: vi.fn(),
    registerCallbackListener: vi.fn(),
    connect: vi.fn<() => Promise<void>>(),
    disconnect: vi.fn<() => void>(),
    socketCallBackResponse: vi.fn<(id: string, ack: unknown) => void>(),
    isCurrentConfigValid: vi.fn<() => boolean>(),
    isLoopBusy: vi.fn<(loopId: string) => boolean>(),
    addMessage: vi.fn<(browserId: string, loopId: string, message: {content: string}) => void>(),
    invoke: vi.fn<(...args: unknown[]) => {busy: boolean; msgId: string}>(),
    error: vi.fn<(message: string) => void>(),
}));

vi.mock('dingtalk-stream', () => ({
    DWClient: mocks.client,
    TOPIC_ROBOT: '/v1.0/im/bot/messages/get',
    EventAck: {SUCCESS: 200},
}));

vi.mock('@deepclaw/config', () => ({isCurrentConfigValid: mocks.isCurrentConfigValid}));

vi.mock('@deepclaw/i18n', () => ({i18nInstance: {t: (key: string) => key}}));

vi.mock('@deepclaw/loop-gateway', () => ({
    LoopGateway: {isLoopBusy: mocks.isLoopBusy, addMessage: mocks.addMessage, invoke: mocks.invoke},
}));

vi.mock('@deepclaw/node-utils', () => ({
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.error}),
}));

function listener(): (event: DWClientDownStream) => void {
    return mocks.registerCallbackListener.mock.calls[0]![1];
}

function downStream(text: string, messageId: string): DWClientDownStream {
    return {
        headers: {messageId},
        data: JSON.stringify({text: {content: text}, sessionWebhook: 'https://hook'}),
    } as DWClientDownStream;
}

function flush(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true}));
    mocks.isCurrentConfigValid.mockReturnValue(true);
    mocks.isLoopBusy.mockReturnValue(false);
    mocks.invoke.mockReturnValue({busy: false, msgId: 'msg-1'});
    mocks.connect.mockResolvedValue(undefined);
    mocks.registerCallbackListener.mockImplementation(() => ({connect: mocks.connect}));
    // A plain function, so the engine can call it with new.
    mocks.client.mockImplementation(function () {
        return {
            registerCallbackListener: mocks.registerCallbackListener,
            socketCallBackResponse: mocks.socketCallBackResponse,
            disconnect: mocks.disconnect,
        };
    });
});

describe('connect', () => {

    test('builds the client out of the credentials', async () => {
        await dingTalk.connect('app-id', 'app-secret', 'a1');
        expect(mocks.client).toHaveBeenCalledWith({clientId: 'app-id', clientSecret: 'app-secret'});
    });

    test('listens on the robot topic', async () => {
        await dingTalk.connect('app-id', 'app-secret', 'a1');
        expect(mocks.registerCallbackListener.mock.calls[0]![0]).toBe('/v1.0/im/bot/messages/get');
    });

    test('waits for the client to be connected', async () => {
        let connected = false;
        mocks.connect.mockImplementation(async () => {
            await Promise.resolve();
            connected = true;
        });
        await dingTalk.connect('app-id', 'app-secret', 'a1');
        expect(connected).toBe(true);
    });

    test('passes a failing handshake to the caller', async () => {
        mocks.connect.mockRejectedValue(new Error('bad credentials'));
        await expect(dingTalk.connect('app-id', 'app-secret', 'a1')).rejects.toThrow('bad credentials');
    });

    test('routes an incoming message to the agent', async () => {
        await dingTalk.connect('app-id', 'app-secret', 'a1');
        listener()(downStream('hi', 'm1'));
        await flush();
        expect(mocks.invoke).toHaveBeenCalledOnce();
        expect(mocks.addMessage.mock.calls[0]![2].content).toBe('📱 hi');
    });

    test('keeps one handler for the whole connection', async () => {
        await dingTalk.connect('app-id', 'app-secret', 'a1');
        listener()(downStream('hi', 'm1'));
        listener()(downStream('hi', 'm1'));
        await flush();
        expect(mocks.socketCallBackResponse).toHaveBeenCalledTimes(2);
        expect(mocks.invoke).toHaveBeenCalledOnce();
    });

    test('gives every connection a handler of its own', async () => {
        await dingTalk.connect('app-id', 'app-secret', 'a1');
        const first = listener();
        await dingTalk.connect('app-id', 'app-secret', 'a2');
        const second = mocks.registerCallbackListener.mock.calls[1]![1];
        first(downStream('hi', 'm1'));
        second(downStream('hi', 'm1'));
        await flush();
        expect(mocks.invoke).toHaveBeenCalledTimes(2);
    });
});

describe('disconnect', () => {

    test('closes the client', async () => {
        const {disconnect} = await dingTalk.connect('app-id', 'app-secret', 'a1');
        disconnect();
        expect(mocks.disconnect).toHaveBeenCalledOnce();
    });

    test('logs a client that refuses to close instead of throwing', async () => {
        mocks.disconnect.mockImplementation(() => {
            throw new Error('already gone');
        });
        const {disconnect} = await dingTalk.connect('app-id', 'app-secret', 'a1');
        expect(() => disconnect()).not.toThrow();
        expect(mocks.error).toHaveBeenCalled();
    });
});
