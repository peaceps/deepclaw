import {beforeEach, describe, expect, test, vi} from 'vitest';
import type {DWClient, DWClientDownStream} from 'dingtalk-stream';
import {type ImageContent} from '@deepclaw/core';
import {DingtalkMessageHandler} from './dingtalk-message-handler';

const mocks = vi.hoisted(() => ({
    isCurrentConfigValid: vi.fn<() => boolean>(),
    isLoopBusy: vi.fn<(loopId: string) => boolean>(),
    addMessage: vi.fn<(browserId: string, loopId: string, message: {content: string}) => void>(),
    invoke: vi.fn<(...args: unknown[]) => {busy: boolean; msgId: string}>(),
    error: vi.fn<(message: string) => void>(),
    info: vi.fn<(message: string) => void>(),
    warn: vi.fn<(message: string) => void>(),
    fetch: vi.fn<(url: string, init?: {body?: unknown}) => Promise<unknown>>(),
    readImage: vi.fn<(key: string) => Buffer | null>(),
}));

vi.mock('dingtalk-stream', () => ({EventAck: {SUCCESS: 200}, TOPIC_ROBOT: '/v1.0/im/bot/messages/get'}));

vi.mock('@deepclaw/config', () => ({isCurrentConfigValid: mocks.isCurrentConfigValid}));

vi.mock('@deepclaw/i18n', () => ({i18nInstance: {t: (key: string) => key}}));

vi.mock('@deepclaw/loop-gateway', () => ({
    LoopGateway: {isLoopBusy: mocks.isLoopBusy, addMessage: mocks.addMessage, invoke: mocks.invoke},
}));

vi.mock('@deepclaw/node-utils', () => ({
    getLogger: () => ({debug: vi.fn(), info: mocks.info, warn: mocks.warn, error: mocks.error}),
    ImageStore: {read: mocks.readImage},
}));

type Payload = {
    msgtype?: string;
    text?: {content?: string};
    sessionWebhook?: string;
    senderStaffId?: string;
    robotCode?: string;
    content?: {
        downloadCode?: string;
        pictureDownloadCode?: string;
        richText?: {type?: string; text?: string; downloadCode?: string}[];
    };
};

const DOWNLOAD_API = 'https://api.dingtalk.com/v1.0/robot/messageFiles/download';
const UPLOAD_API = 'https://oapi.dingtalk.com/media/upload';
const PNG_BYTES = Buffer.from('89504e470d0a1a0a', 'hex');

function downStream(payload: Payload, messageId = 'm1'): DWClientDownStream {
    return {headers: {messageId}, data: JSON.stringify(payload)} as DWClientDownStream;
}

function malformed(messageId = 'm1'): DWClientDownStream {
    return {headers: {messageId}, data: 'not json'} as DWClientDownStream;
}

function flush(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function postedBody(call = 0): {msgtype: string; markdown: {title: string; text: string}; at: {atUserIds: string[]}} {
    return JSON.parse(mocks.fetch.mock.calls[call]![1]!.body as string);
}

function bodyOf(url: string): {robotCode?: string; downloadCode?: string} {
    const call = mocks.fetch.mock.calls.find(([called]) => called === url);
    return JSON.parse(call![1]!.body as string);
}

function imagesOf(call = 0): ImageContent[] | undefined {
    return (mocks.invoke.mock.calls[call]![1] as {images?: ImageContent[]}).images;
}

function onDone(call = 0): (text: string) => void {
    return mocks.invoke.mock.calls[call]![4] as (text: string) => void;
}

/** The webhook, the download api and the file itself all go through fetch, so answer by url. */
function stubDownload(bytes: string | Buffer = 'the image', mediaType = 'image/png'): void {
    mocks.fetch.mockImplementation((url: string) => {
        if (url === DOWNLOAD_API) {
            return Promise.resolve({ok: true, json: () => Promise.resolve({downloadUrl: 'https://files/1'})});
        }
        if (url === 'https://files/1') {
            return Promise.resolve({
                ok: true,
                headers: new Headers({'content-type': mediaType}),
                arrayBuffer: () => Promise.resolve(Buffer.from(bytes)),
            });
        }
        return Promise.resolve({ok: true});
    });
}

let client: {
    socketCallBackResponse: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    getAccessToken: ReturnType<typeof vi.fn>;
};
let handler: DingtalkMessageHandler;

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.fetch.mockResolvedValue({ok: true});
    mocks.isCurrentConfigValid.mockReturnValue(true);
    mocks.isLoopBusy.mockReturnValue(false);
    mocks.invoke.mockReturnValue({busy: false, msgId: 'msg-1'});
    client = {
        socketCallBackResponse: vi.fn(),
        disconnect: vi.fn(),
        getAccessToken: vi.fn().mockResolvedValue('token-1'),
    };
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
        expect(postedBody().markdown.text).toBe('im.wait');
    });

    test('sends the reply as markdown', async () => {
        handler.onMessage(downStream({text: {content: 'hi'}, sessionWebhook: 'https://hook'}));
        await flush();
        expect(postedBody().msgtype).toBe('markdown');
    });

    test('titles the reply with the first line of the answer', async () => {
        handler.onMessage(downStream({text: {content: 'hi'}, sessionWebhook: 'https://hook'}));
        await flush();
        onDone()('the first line\nthe rest of it');
        expect(postedBody(1).markdown.title).toBe('the first line');
    });

    test('cuts a long title down', async () => {
        handler.onMessage(downStream({text: {content: 'hi'}, sessionWebhook: 'https://hook'}));
        await flush();
        onDone()('x'.repeat(50));
        expect(postedBody(1).markdown.title).toHaveLength(20);
    });

    test('leaves an answer without any picture untouched', async () => {
        handler.onMessage(downStream({text: {content: 'hi'}, sessionWebhook: 'https://hook'}));
        await flush();
        onDone()('  a plain answer  ');
        expect(postedBody(1).markdown.text).toBe('  a plain answer  ');
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

describe('sending the images of an answer', () => {

    function stubUpload(answer: {media_id?: string; errmsg?: string} = {media_id: '@media-1'}): void {
        mocks.fetch.mockImplementation((url: string) => url.startsWith(UPLOAD_API)
            ? Promise.resolve({ok: true, status: 200, json: () => Promise.resolve(answer)})
            : Promise.resolve({ok: true}));
    }

    function uploads(): string[] {
        return mocks.fetch.mock.calls.map(([url]) => url).filter(url => url.startsWith(UPLOAD_API));
    }

    /** The wait message went out first, the answer is whatever reached the webhook last. */
    function answered(): string {
        const posts = mocks.fetch.mock.calls.filter(([url]) => url === 'https://hook');
        const body = JSON.parse(posts[posts.length - 1]![1]!.body as string) as {markdown: {text: string}};
        return body.markdown.text;
    }

    async function answer(text: string): Promise<void> {
        handler.onMessage(downStream({text: {content: 'hi'}, sessionWebhook: 'https://hook'}));
        await flush();
        onDone()(text);
        await flush();
    }

    beforeEach(() => {
        mocks.readImage.mockReturnValue(PNG_BYTES);
        stubUpload();
    });

    test('uploads the bytes of a stored picture', async () => {
        await answer('![shot](dcimg://abc.png)');
        expect(mocks.readImage).toHaveBeenCalledWith('abc.png');
        expect(uploads()).toEqual([`${UPLOAD_API}?access_token=token-1&type=image`]);
    });

    test('names the uploaded media where the picture stood', async () => {
        await answer('here it is\n\n![shot](dcimg://abc.png)');
        expect(answered()).toBe('here it is\n\n![shot](@media-1)');
    });

    test('sends a picture that came without any words', async () => {
        await answer('![shot](dcimg://abc.png)');
        expect(answered()).toBe('![shot](@media-1)');
    });

    test('keeps two pictures each in its own place', async () => {
        await answer('first\n\n![one](dcimg://a.png)\n\nthen\n\n![two](dcimg://b.png)');
        expect(uploads()).toHaveLength(2);
        expect(answered()).toBe('first\n\n![one](@media-1)\n\nthen\n\n![two](@media-1)');
    });

    test('uploads a picture the answer inlined', async () => {
        await answer('![shot](data:image/png;base64,QUJD)');
        expect(uploads()).toHaveLength(1);
        expect(answered()).toBe('![shot](@media-1)');
    });

    test('leaves a linked picture for the client to fetch', async () => {
        await answer('![shot](https://host/shot.png)');
        expect(uploads()).toEqual([]);
        expect(answered()).toBe('![shot](https://host/shot.png)');
    });

    test('says the picture could not be sent when the upload is refused', async () => {
        stubUpload({errmsg: 'no permission'});
        await answer('here it is\n\n![shot](dcimg://abc.png)');
        expect(mocks.error).toHaveBeenCalled();
        expect(answered()).toBe('here it is\n\nim.imagesNotSent');
    });

    test('says so when the bytes of a stored picture are gone', async () => {
        mocks.readImage.mockReturnValue(null);
        await answer('![shot](dcimg://abc.png)');
        expect(uploads()).toEqual([]);
        expect(answered()).toBe('im.imagesNotSent');
    });
});

describe('reading the images of a message', () => {

    function picture(): DWClientDownStream {
        return downStream({
            msgtype: 'picture', content: {downloadCode: 'dc-1'},
            sessionWebhook: 'https://hook', robotCode: 'bot-1',
        });
    }

    function richText(): DWClientDownStream {
        return downStream({
            msgtype: 'richText',
            content: {richText: [
                {text: 'look at '}, {type: 'picture', downloadCode: 'dc-1'},
                {text: 'this'}, {type: 'picture', downloadCode: 'dc-2'},
            ]},
            sessionWebhook: 'https://hook', robotCode: 'bot-1',
        });
    }

    test('asks dingtalk for the file behind the download code', async () => {
        stubDownload();
        handler.onMessage(picture());
        await flush();
        expect(bodyOf(DOWNLOAD_API)).toEqual({robotCode: 'bot-1', downloadCode: 'dc-1'});
    });

    test('hands the picture to the run as a data url', async () => {
        stubDownload('the image', 'image/png');
        handler.onMessage(picture());
        await flush();
        expect(imagesOf()).toEqual([{
            url: `data:image/png;base64,${Buffer.from('the image').toString('base64')}`,
            mediaType: 'image/png',
        }]);
    });

    test('falls back to the picture download code when there is no plain one', async () => {
        stubDownload();
        handler.onMessage(downStream({
            msgtype: 'picture', content: {pictureDownloadCode: 'dc-2'},
            sessionWebhook: 'https://hook', robotCode: 'bot-1',
        }));
        await flush();
        expect(bodyOf(DOWNLOAD_API)).toEqual({robotCode: 'bot-1', downloadCode: 'dc-2'});
    });

    test('takes every picture out of a rich text message', async () => {
        stubDownload();
        handler.onMessage(richText());
        await flush();
        expect(imagesOf()).toHaveLength(2);
    });

    test('takes the text out of a rich text message', async () => {
        stubDownload();
        handler.onMessage(richText());
        await flush();
        expect(mocks.addMessage.mock.calls[0]![2].content).toBe('📱 look at this');
    });

    test('runs without images for a plain text message', async () => {
        handler.onMessage(downStream({text: {content: 'hi'}, sessionWebhook: 'https://hook'}));
        await flush();
        expect(imagesOf()).toBeUndefined();
    });

    test('reads the type out of the bytes when the link answers with octet-stream', async () => {
        stubDownload(PNG_BYTES, 'application/octet-stream');
        handler.onMessage(picture());
        await flush();
        expect(imagesOf()![0]!.mediaType).toBe('image/png');
    });

    test('falls back to jpeg for bytes it cannot recognise', async () => {
        stubDownload('the image', 'application/octet-stream');
        handler.onMessage(picture());
        await flush();
        expect(imagesOf()![0]!.mediaType).toBe('image/jpeg');
    });

    test('skips the download when the robot code is missing', async () => {
        stubDownload();
        handler.onMessage(downStream({
            msgtype: 'picture', content: {downloadCode: 'dc-1'}, sessionWebhook: 'https://hook',
        }));
        await flush();
        expect(mocks.warn).toHaveBeenCalled();
        expect(imagesOf()).toBeUndefined();
    });

    test('runs anyway when dingtalk refuses the download', async () => {
        mocks.fetch.mockImplementation((url: string) => Promise.resolve(
            url === DOWNLOAD_API ? {ok: false, status: 403, text: () => Promise.resolve('nope')} : {ok: true}
        ));
        handler.onMessage(picture());
        await flush();
        expect(mocks.error).toHaveBeenCalled();
        expect(imagesOf()).toBeUndefined();
    });
});
