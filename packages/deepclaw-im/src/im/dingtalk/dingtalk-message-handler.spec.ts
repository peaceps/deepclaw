import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {DWClient, DWClientDownStream} from 'dingtalk-stream';
import {DingtalkMessageHandler} from './dingtalk-message-handler';

const mocks = vi.hoisted(() => ({
    isCurrentConfigValid: vi.fn<() => boolean>(),
    isLoopBusy: vi.fn<(loopId: string) => boolean>(),
    addMessage: vi.fn<(browserId: string, loopId: string, message: {content: string}) => void>(),
    invoke: vi.fn<(...args: unknown[]) => {busy: boolean; msgId: string}>(),
    error: vi.fn<(message: string) => void>(),
    info: vi.fn<(message: string) => void>(),
    fetch: vi.fn<(url: string, init: {body: string}) => Promise<unknown>>(),
}));

vi.mock('dingtalk-stream', () => ({EventAck: {SUCCESS: 200}, TOPIC_ROBOT: '/v1.0/im/bot/messages/get'}));

vi.mock('@deepclaw/config', () => ({isCurrentConfigValid: mocks.isCurrentConfigValid}));

vi.mock('@deepclaw/i18n', () => ({i18nInstance: {t: (key: string) => key}}));

vi.mock('@deepclaw/loop-gateway', () => ({
    LoopGateway: {isLoopBusy: mocks.isLoopBusy, addMessage: mocks.addMessage, invoke: mocks.invoke},
}));

vi.mock('@deepclaw/node-utils', () => ({
    getLogger: () => ({debug: vi.fn(), info: mocks.info, warn: vi.fn(), error: mocks.error}),
}));

type Payload = {
    text?: {content?: string};
    sessionWebhook?: string;
    senderStaffId?: string;
};

function downStream(payload: Payload, messageId = 'm1'): DWClientDownStream {
    return {headers: {messageId}, data: JSON.stringify(payload)} as DWClientDownStream;
}

function malformed(messageId = 'm1'): DWClientDownStream {
    return {headers: {messageId}, data: 'not json'} as DWClientDownStream;
}

function flush(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function postedBody(call = 0): {msgtype: string; text: {content: string}; at: {atUserIds: string[]}} {
    return JSON.parse(mocks.fetch.mock.calls[call]![1].body);
}

let client: {socketCallBackResponse: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>};
let handler: DingtalkMessageHandler;

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.fetch.mockResolvedValue({ok: true});
    mocks.isCurrentConfigValid.mockReturnValue(true);
    mocks.isLoopBusy.mockReturnValue(false);
    mocks.invoke.mockReturnValue({busy: false, msgId: 'msg-1'});
    client = {socketCallBackResponse: vi.fn(), disconnect: vi.fn()};
    handler = new DingtalkMessageHandler('a1', client as unknown as DWClient);
});

describe('acknowledging the stream', () => {

    test('answers the socket with the id of the message', () => {
        handler.onMessage(downStream({text: {content: 'hi'}, sessionWebhook: 'https://hook'}));
        expect(client.socketCallBackResponse).toHaveBeenCalledWith('m1', {status: 200, message: 'OK'});
    });

    test('answers the socket even for a payload it cannot read', () => {
        handler.onMessage(malformed());
        expect(client.socketCallBackResponse).toHaveBeenCalledOnce();
    });

    test('keeps handling the message when the socket answer fails', async () => {
        client.socketCallBackResponse.mockImplementation(() => {
            throw new Error('socket gone');
        });
        handler.onMessage(downStream({text: {content: 'hi'}, sessionWebhook: 'https://hook'}));
        await flush();
        expect(mocks.error).toHaveBeenCalled();
        expect(mocks.invoke).toHaveBeenCalledOnce();
    });
});

describe('reading a message', () => {

    test('takes the text out of the payload', async () => {
        handler.onMessage(downStream({text: {content: 'hi'}, sessionWebhook: 'https://hook'}));
        await flush();
        expect(mocks.addMessage.mock.calls[0]![2].content).toBe('📱 hi');
    });

    test('trims the text of the payload', async () => {
        handler.onMessage(downStream({text: {content: '  hi  '}, sessionWebhook: 'https://hook'}));
        await flush();
        expect(mocks.addMessage.mock.calls[0]![2].content).toBe('📱 hi');
    });

    test('reads a payload without any text as empty', async () => {
        handler.onMessage(downStream({sessionWebhook: 'https://hook'}));
        await flush();
        expect(mocks.addMessage.mock.calls[0]![2].content).toBe('📱 ');
    });

    test('drops a payload that is not json', async () => {
        handler.onMessage(malformed());
        await flush();
        expect(mocks.error).toHaveBeenCalled();
        expect(mocks.invoke).not.toHaveBeenCalled();
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
});

describe('replying through the webhook', () => {

    test('posts the reply to the session webhook of the message', async () => {
        handler.onMessage(downStream({text: {content: 'hi'}, sessionWebhook: 'https://hook'}));
        await flush();
        expect(mocks.fetch.mock.calls[0]![0]).toBe('https://hook');
        expect(postedBody().text.content).toBe('im.wait');
    });

    test('sends the reply as plain text', async () => {
        handler.onMessage(downStream({text: {content: 'hi'}, sessionWebhook: 'https://hook'}));
        await flush();
        expect(postedBody().msgtype).toBe('text');
    });

    test('mentions the sender of the message', async () => {
        handler.onMessage(downStream({
            text: {content: 'hi'}, sessionWebhook: 'https://hook', senderStaffId: 'u1',
        }));
        await flush();
        expect(postedBody().at.atUserIds).toEqual(['u1']);
    });

    test('mentions nobody when the sender is unknown', async () => {
        handler.onMessage(downStream({text: {content: 'hi'}, sessionWebhook: 'https://hook'}));
        await flush();
        expect(postedBody().at.atUserIds).toEqual(['']);
    });

    test('answers each message on its own webhook', async () => {
        handler.onMessage(downStream({text: {content: 'hi'}, sessionWebhook: 'https://hook-1'}, 'm1'));
        mocks.isLoopBusy.mockReturnValue(true);
        handler.onMessage(downStream({text: {content: 'again'}, sessionWebhook: 'https://hook-2'}, 'm2'));
        await flush();
        expect(mocks.fetch.mock.calls.map(call => call[0])).toEqual(['https://hook-1', 'https://hook-2']);
    });

    test('says nothing when the message carries no webhook', async () => {
        handler.onMessage(downStream({text: {content: 'hi'}}));
        await flush();
        expect(mocks.fetch).not.toHaveBeenCalled();
        expect(mocks.info).toHaveBeenCalled();
    });

    test('logs a webhook that refuses the reply', async () => {
        mocks.fetch.mockRejectedValue(new Error('bad gateway'));
        handler.onMessage(downStream({text: {content: 'hi'}, sessionWebhook: 'https://hook'}));
        await flush();
        expect(mocks.error).toHaveBeenCalled();
    });
});
