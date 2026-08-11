import {Readable} from 'stream';
import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {LarkChannel, NormalizedMessage} from '@larksuiteoapi/node-sdk';
import {type ImageContent} from '@deepclaw/core';
import {FeishuMessageHandler} from './feishu-message-handler';

const mocks = vi.hoisted(() => ({
    send: vi.fn<(to: string, input: unknown, opts: unknown) => Promise<unknown>>(),
    getResource: vi.fn<(payload: {
        path: {message_id: string; file_key: string}; params: {type: string};
    }) => Promise<{getReadableStream: () => Readable}>>(),
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

function messageWithImage(content: string, fileKey = 'img-1'): NormalizedMessage {
    return {
        messageId: 'm1', chatId: 'chat-1', content,
        resources: [{type: 'image', fileKey}],
    } as NormalizedMessage;
}

function downloaded(bytes: string | Buffer): {getReadableStream: () => Readable} {
    return {getReadableStream: () => Readable.from([Buffer.from(bytes)])};
}

const PNG_BYTES = Buffer.from('89504e470d0a1a0a', 'hex');

function flush(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function imagesOf(call = 0): ImageContent[] | undefined {
    return (mocks.invoke.mock.calls[call]![1] as {images?: ImageContent[]}).images;
}

function onDone(call = 0): (text: string) => void {
    return mocks.invoke.mock.calls[call]![4] as (text: string) => void;
}

function sentContents(): unknown[] {
    return mocks.send.mock.calls.map(call => call[1]);
}

let handler: FeishuMessageHandler;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.send.mockResolvedValue({messageId: 'sent-1'});
    mocks.isCurrentConfigValid.mockReturnValue(true);
    mocks.isLoopBusy.mockReturnValue(false);
    mocks.invoke.mockReturnValue({busy: false, msgId: 'msg-1'});
    handler = new FeishuMessageHandler('a1', {
        send: mocks.send,
        rawClient: {im: {v1: {messageResource: {get: mocks.getResource}}}},
    } as unknown as LarkChannel);
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

describe('reading the images of a message', () => {

    beforeEach(() => {
        mocks.getResource.mockResolvedValue(downloaded('the image'));
    });

    test('reads the picture through the message that carries it', async () => {
        handler.onMessage(messageWithImage('look'));
        await flush();
        expect(mocks.getResource).toHaveBeenCalledWith({
            path: {message_id: 'm1', file_key: 'img-1'}, params: {type: 'image'},
        });
    });

    test('hands the downloaded image to the run as a data url', async () => {
        handler.onMessage(messageWithImage('look'));
        await flush();
        expect(imagesOf()).toEqual([{
            url: `data:image/jpeg;base64,${Buffer.from('the image').toString('base64')}`,
            mediaType: 'image/jpeg',
        }]);
    });

    test('takes the media type out of the bytes', async () => {
        mocks.getResource.mockResolvedValue(downloaded(PNG_BYTES));
        handler.onMessage(messageWithImage('look'));
        await flush();
        expect(imagesOf()![0]!.mediaType).toBe('image/png');
    });

    test('leaves the image placeholder out of the text of the run', async () => {
        handler.onMessage(messageWithImage('look ![image](img-1)'));
        await flush();
        expect(mocks.addMessage.mock.calls[0]![2].content).toBe('📱 look');
    });

    test('runs without images when the message carries none', async () => {
        handler.onMessage(message('hi'));
        await flush();
        expect(mocks.getResource).not.toHaveBeenCalled();
        expect(imagesOf()).toBeUndefined();
    });

    test('runs anyway when the download fails', async () => {
        mocks.getResource.mockRejectedValue(new Error('download failed'));
        handler.onMessage(messageWithImage('look'));
        await flush();
        expect(mocks.error).toHaveBeenCalled();
        expect(imagesOf()).toBeUndefined();
    });
});

describe('sending the images of an answer', () => {

    beforeEach(async () => {
        handler.onMessage(message('hi'));
        await flush();
        mocks.send.mockClear();
    });

    test('keeps an answer without images in one markdown message', async () => {
        onDone()('just words');
        await flush();
        expect(sentContents()).toEqual([{markdown: 'just words'}]);
    });

    test('splits the words of the answer from its images', async () => {
        onDone()('here it is ![shot](data:image/png;base64,QUJD)');
        await flush();
        expect(sentContents()).toEqual([
            {markdown: 'here it is'},
            {image: {source: Buffer.from('ABC')}},
        ]);
    });

    test('sends an image alone when the answer is only an image', async () => {
        onDone()('![shot](data:image/png;base64,QUJD)');
        await flush();
        expect(sentContents()).toEqual([{image: {source: Buffer.from('ABC')}}]);
    });

    test('leaves a linked image for the channel to fetch', async () => {
        onDone()('![shot](https://host/shot.png)');
        await flush();
        expect(sentContents()).toEqual([{image: {source: 'https://host/shot.png'}}]);
    });

    test('logs an image url it cannot turn into bytes', async () => {
        onDone()('![shot](ftp://host/shot.png)');
        await flush();
        expect(mocks.error).toHaveBeenCalled();
        expect(sentContents()).toEqual([]);
    });

    test('logs a channel that refuses an image', async () => {
        mocks.send.mockRejectedValue(new Error('no permission'));
        onDone()('![shot](data:image/png;base64,QUJD)');
        await flush();
        expect(mocks.error).toHaveBeenCalled();
    });
});
