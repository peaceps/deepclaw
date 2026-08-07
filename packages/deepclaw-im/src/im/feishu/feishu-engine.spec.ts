import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {NormalizedMessage} from '@larksuiteoapi/node-sdk';
import {feishu} from './feishu-engine';

const mocks = vi.hoisted(() => ({
    createLarkChannel: vi.fn(),
    on: vi.fn(),
    connect: vi.fn<() => Promise<void>>(),
    disconnect: vi.fn<() => Promise<void>>(),
    send: vi.fn<(to: string, input: unknown, opts: unknown) => Promise<unknown>>(),
    isCurrentConfigValid: vi.fn<() => boolean>(),
    isLoopBusy: vi.fn<(loopId: string) => boolean>(),
    addMessage: vi.fn<(browserId: string, loopId: string, message: {content: string}) => void>(),
    invoke: vi.fn<(...args: unknown[]) => {busy: boolean; msgId: string}>(),
    error: vi.fn<(message: string) => void>(),
}));

vi.mock('@larksuiteoapi/node-sdk', () => ({createLarkChannel: mocks.createLarkChannel}));

vi.mock('@deepclaw/config', () => ({isCurrentConfigValid: mocks.isCurrentConfigValid}));

vi.mock('@deepclaw/i18n', () => ({i18nInstance: {t: (key: string) => key}}));

vi.mock('@deepclaw/loop-gateway', () => ({
    LoopGateway: {isLoopBusy: mocks.isLoopBusy, addMessage: mocks.addMessage, invoke: mocks.invoke},
}));

vi.mock('@deepclaw/node-utils', () => ({
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.error}),
}));

function listener(call = 0): (message: NormalizedMessage) => void {
    return mocks.on.mock.calls[call]![1];
}

function message(content: string, messageId = 'm1'): NormalizedMessage {
    return {messageId, chatId: 'chat-1', content} as NormalizedMessage;
}

function flush(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.isCurrentConfigValid.mockReturnValue(true);
    mocks.isLoopBusy.mockReturnValue(false);
    mocks.invoke.mockReturnValue({busy: false, msgId: 'msg-1'});
    mocks.connect.mockResolvedValue(undefined);
    mocks.disconnect.mockResolvedValue(undefined);
    mocks.send.mockResolvedValue({messageId: 'sent-1'});
    mocks.createLarkChannel.mockImplementation(() => ({
        on: mocks.on,
        connect: mocks.connect,
        disconnect: mocks.disconnect,
        send: mocks.send,
    }));
});

describe('connect', () => {

    test('builds the channel out of the credentials', async () => {
        await feishu.connect('app-id', 'app-secret', 'a1');
        expect(mocks.createLarkChannel).toHaveBeenCalledWith({appId: 'app-id', appSecret: 'app-secret'});
    });

    test('subscribes to messages before the channel opens', async () => {
        let subscribedFirst = false;
        mocks.connect.mockImplementation(async () => {
            subscribedFirst = mocks.on.mock.calls.length > 0;
        });
        await feishu.connect('app-id', 'app-secret', 'a1');
        expect(subscribedFirst).toBe(true);
        expect(mocks.on.mock.calls[0]![0]).toBe('message');
    });

    test('waits for the channel to be connected', async () => {
        let connected = false;
        mocks.connect.mockImplementation(async () => {
            await Promise.resolve();
            connected = true;
        });
        await feishu.connect('app-id', 'app-secret', 'a1');
        expect(connected).toBe(true);
    });

    test('passes a failing handshake to the caller', async () => {
        mocks.connect.mockRejectedValue(new Error('bad credentials'));
        await expect(feishu.connect('app-id', 'app-secret', 'a1')).rejects.toThrow('bad credentials');
    });

    test('routes an incoming message to the agent', async () => {
        await feishu.connect('app-id', 'app-secret', 'a1');
        listener()(message('hi'));
        await flush();
        expect(mocks.invoke).toHaveBeenCalledOnce();
        expect(mocks.addMessage.mock.calls[0]![2].content).toBe('📱 hi');
    });

    test('keeps one handler for the whole connection', async () => {
        await feishu.connect('app-id', 'app-secret', 'a1');
        listener()(message('hi'));
        listener()(message('hi'));
        await flush();
        expect(mocks.invoke).toHaveBeenCalledOnce();
    });

    test('gives every connection a handler of its own', async () => {
        await feishu.connect('app-id', 'app-secret', 'a1');
        await feishu.connect('app-id', 'app-secret', 'a2');
        listener(0)(message('hi'));
        listener(1)(message('hi'));
        await flush();
        expect(mocks.invoke).toHaveBeenCalledTimes(2);
    });
});

describe('disconnect', () => {

    test('closes the channel', async () => {
        const {disconnect} = await feishu.connect('app-id', 'app-secret', 'a1');
        disconnect();
        expect(mocks.disconnect).toHaveBeenCalledOnce();
    });

    test('logs a channel that refuses to close instead of throwing', async () => {
        mocks.disconnect.mockRejectedValue(new Error('already gone'));
        const {disconnect} = await feishu.connect('app-id', 'app-secret', 'a1');
        expect(() => disconnect()).not.toThrow();
        await flush();
        expect(mocks.error).toHaveBeenCalled();
    });
});
