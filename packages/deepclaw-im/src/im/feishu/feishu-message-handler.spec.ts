import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {LarkChannel, NormalizedMessage} from '@larksuiteoapi/node-sdk';
import {FeishuMessageHandler} from './feishu-message-handler';

const mocks = vi.hoisted(() => ({
    send: vi.fn<(to: string, input: unknown, opts: unknown) => Promise<unknown>>(),
    isCurrentConfigValid: vi.fn<() => boolean>(),
    isLoopBusy: vi.fn<(loopId: string) => boolean>(),
    addMessage: vi.fn<(browserId: string, loopId: string, message: {content: string}) => void>(),
    invoke: vi.fn<(...args: unknown[]) => {busy: boolean; msgId: string}>(),
    error: vi.fn<(message: string) => void>(),
}));

vi.mock('@larksuiteoapi/node-sdk', () => ({}));

vi.mock('@deepclaw/config', () => ({isCurrentConfigValid: mocks.isCurrentConfigValid}));

vi.mock('@deepclaw/i18n', () => ({i18nInstance: {t: (key: string) => key}}));

vi.mock('@deepclaw/loop-gateway', () => ({
    LoopGateway: {isLoopBusy: mocks.isLoopBusy, addMessage: mocks.addMessage, invoke: mocks.invoke},
}));

vi.mock('@deepclaw/node-utils', () => ({
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.error}),
}));

function message(content: string, messageId = 'm1', chatId = 'chat-1'): NormalizedMessage {
    return {messageId, chatId, content} as NormalizedMessage;
}

function flush(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

let handler: FeishuMessageHandler;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.send.mockResolvedValue({messageId: 'sent-1'});
    mocks.isCurrentConfigValid.mockReturnValue(true);
    mocks.isLoopBusy.mockReturnValue(false);
    mocks.invoke.mockReturnValue({busy: false, msgId: 'msg-1'});
    handler = new FeishuMessageHandler('a1', {send: mocks.send} as unknown as LarkChannel);
});

describe('reading a message', () => {

    test('takes the content of the message', async () => {
        handler.onMessage(message('hi'));
        await flush();
        expect(mocks.addMessage.mock.calls[0]![2].content).toBe('📱 hi');
    });

    test('trims the content of the message', async () => {
        handler.onMessage(message('  hi  '));
        await flush();
        expect(mocks.addMessage.mock.calls[0]![2].content).toBe('📱 hi');
    });

    test('reads a message without content as empty', async () => {
        handler.onMessage({messageId: 'm1', chatId: 'chat-1'} as NormalizedMessage);
        await flush();
        expect(mocks.addMessage.mock.calls[0]![2].content).toBe('📱 ');
    });

    test('handles the same message only once', async () => {
        handler.onMessage(message('hi'));
        handler.onMessage(message('hi'));
        await flush();
        expect(mocks.invoke).toHaveBeenCalledOnce();
    });
});

describe('replying through the channel', () => {

    test('sends the reply to the chat of the message', async () => {
        handler.onMessage(message('hi'));
        await flush();
        expect(mocks.send.mock.calls[0]![0]).toBe('chat-1');
    });

    test('sends the reply as markdown', async () => {
        handler.onMessage(message('hi'));
        await flush();
        expect(mocks.send.mock.calls[0]![1]).toEqual({markdown: 'im.wait'});
    });

    test('hangs the reply under the message it answers', async () => {
        handler.onMessage(message('hi'));
        await flush();
        expect(mocks.send.mock.calls[0]![2]).toEqual({replyTo: 'm1'});
    });

    test('answers each message in its own chat', async () => {
        handler.onMessage(message('hi', 'm1', 'chat-1'));
        mocks.isLoopBusy.mockReturnValue(true);
        handler.onMessage(message('again', 'm2', 'chat-2'));
        await flush();
        expect(mocks.send.mock.calls.map(call => call[0])).toEqual(['chat-1', 'chat-2']);
    });

    test('logs a channel that refuses the reply', async () => {
        mocks.send.mockRejectedValue(new Error('no permission'));
        handler.onMessage(message('hi'));
        await flush();
        expect(mocks.error).toHaveBeenCalled();
    });
});
