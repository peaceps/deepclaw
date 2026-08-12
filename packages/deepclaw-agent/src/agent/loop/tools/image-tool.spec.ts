import type {ImageModel} from '@deepclaw/config';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {newTestAgentConfig, newTestContext} from '../../../test-support/one-loop-context';
import {generateImageTool} from './image-tool';

const mocks = vi.hoisted(() => ({
    save: vi.fn<(bytes: Buffer, extension: string, loopId: string) => string>(
        (_bytes, extension, loopId) => `${loopId}/abcd1234.${extension}`
    ),
    read: vi.fn<(key: string) => Buffer | null>(() => Buffer.from('source-bytes')),
}));

vi.mock('@deepclaw/i18n', () => ({
    i18nInstance: {
        t: (key: string, params?: Record<string, string>) =>
            params ? `${key} ${JSON.stringify(params)}` : key,
    },
}));
vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    ImageStore: {save: mocks.save, read: mocks.read},
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

const fetchMock = vi.fn();

function generated(imageUrl = 'https://oss.example.com/generated.png') {
    return {
        ok: true,
        status: 200,
        json: async () => ({
            output: {choices: [{finish_reason: 'stop', message: {role: 'assistant', content: [{image: imageUrl}]}}]},
            request_id: 'req-1',
        }),
    };
}

function downloaded(bytes = 'png-bytes', contentType: string | null = 'image/png') {
    return {
        ok: true,
        status: 200,
        headers: {get: () => contentType},
        arrayBuffer: async () => Buffer.from(bytes),
    };
}

function requestBodyOf(call: number): any {
    return JSON.parse(fetchMock.mock.calls[call]![1].body);
}

/** The key and the model belong to the agent that runs the tool, so they arrive with the context. */
function contextWithKey(imageApiKey = 'configured-key', imageModel: ImageModel = 'qwen-image-3.0') {
    return newTestContext({
        loopConfig: newTestAgentConfig({
            llm: {baseURL: 'https://api.example.com', apiKey: 'key', model: 'model', imageModel, imageApiKey},
        }),
    });
}

describe('generateImageTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test('asks dashscope for the model the agent picked and keeps the bytes it hands back', async () => {
        fetchMock.mockResolvedValueOnce(generated()).mockResolvedValueOnce(downloaded());

        const result = await generateImageTool.invoke({prompt: 'a whale in a teacup'}, contextWithKey());

        const [url, request] = fetchMock.mock.calls[0]!;
        expect(url).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
        expect(request.headers.Authorization).toBe('Bearer configured-key');
        expect(requestBodyOf(0)).toMatchObject({
            model: 'qwen-image-3.0',
            input: {messages: [{role: 'user', content: [{text: 'a whale in a teacup'}]}]},
        });
        expect(fetchMock.mock.calls[1]![0]).toBe('https://oss.example.com/generated.png');
        expect(mocks.save).toHaveBeenCalledExactlyOnceWith(Buffer.from('png-bytes'), 'png', 'agent.a1');
        expect(result).toContain('agent.tools.image.saved');
    });

    test('draws with the other qwen model when that is the one picked', async () => {
        fetchMock.mockResolvedValueOnce(generated()).mockResolvedValueOnce(downloaded());

        await generateImageTool.invoke(
            {prompt: 'a whale'}, contextWithKey('k', 'qwen-image-2.0-pro-2026-06-22')
        );

        expect(requestBodyOf(0).model).toBe('qwen-image-2.0-pro-2026-06-22');
    });

    /** Only a reference reaches a chat, an im client and a browser alike. */
    test('hands back the stored image as a reference to the loop it was drawn for', async () => {
        fetchMock.mockResolvedValueOnce(generated()).mockResolvedValueOnce(downloaded());

        const result = await generateImageTool.invoke({prompt: 'a whale'}, contextWithKey());

        expect(result).toContain('"url":"dcimg://agent.a1/abcd1234.png"');
    });

    test('keeps the type the service actually answered with', async () => {
        fetchMock.mockResolvedValueOnce(generated()).mockResolvedValueOnce(downloaded('jpg-bytes', 'image/jpeg'));

        const result = await generateImageTool.invoke({prompt: 'a whale'}, contextWithKey());

        expect(mocks.save).toHaveBeenCalledExactlyOnceWith(Buffer.from('jpg-bytes'), 'jpg', 'agent.a1');
        expect(result).toContain('dcimg://agent.a1/abcd1234.jpg');
    });

    test('falls back to a png when the answer says nothing about its type', async () => {
        fetchMock.mockResolvedValueOnce(generated()).mockResolvedValueOnce(downloaded('bytes', null));

        await generateImageTool.invoke({prompt: 'a whale'}, contextWithKey());

        expect(mocks.save).toHaveBeenCalledExactlyOnceWith(Buffer.from('bytes'), 'png', 'agent.a1');
    });

    test('passes the optional wishes on and leaves out the ones not made', async () => {
        fetchMock.mockResolvedValueOnce(generated()).mockResolvedValueOnce(downloaded());

        await generateImageTool.invoke(
            {prompt: 'a whale', negativePrompt: 'no text', size: '1664*928'}, contextWithKey()
        );

        expect(requestBodyOf(0).parameters).toEqual({
            negative_prompt: 'no text', size: '1664*928', prompt_extend: true, watermark: false,
        });
    });

    test('leaves the resolution to the service when the caller has no opinion', async () => {
        fetchMock.mockResolvedValueOnce(generated()).mockResolvedValueOnce(downloaded());

        await generateImageTool.invoke({prompt: 'a whale'}, contextWithKey());

        expect(requestBodyOf(0).parameters).toEqual({prompt_extend: true, watermark: false});
    });

    test('never picks a vendor for the user when no image model is set', async () => {
        const context = newTestContext({
            loopConfig: newTestAgentConfig({
                llm: {baseURL: 'https://api.example.com', apiKey: 'key', model: 'model', imageApiKey: 'k'},
            }),
        });

        await expect(generateImageTool.invoke({prompt: 'a whale'}, context))
            .rejects.toThrow('agent.tools.image.noModel');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('says so instead of quietly drawing with another model', async () => {
        await expect(generateImageTool.invoke({prompt: 'a whale'}, contextWithKey('k', 'gpt-image-2.0')))
            .rejects.toThrow('agent.tools.image.unsupportedModel {"model":"gpt-image-2.0"}');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('uses the key of the agent it runs as, not a shared one', async () => {
        fetchMock.mockResolvedValueOnce(generated()).mockResolvedValueOnce(downloaded());

        await generateImageTool.invoke({prompt: 'a whale'}, contextWithKey('key-of-this-agent'));

        expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer key-of-this-agent');
    });

    test('falls back to the environment when the agent carries no key', async () => {
        vi.stubEnv('DASHSCOPE_API_KEY', 'env-key');
        fetchMock.mockResolvedValueOnce(generated()).mockResolvedValueOnce(downloaded());

        await generateImageTool.invoke({prompt: 'a whale'}, contextWithKey(''));

        expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer env-key');
        vi.unstubAllEnvs();
    });

    test('says where to put the key instead of calling without one', async () => {
        vi.stubEnv('DASHSCOPE_API_KEY', '');

        await expect(generateImageTool.invoke({prompt: 'a whale'}, contextWithKey('')))
            .rejects.toThrow('agent.tools.image.noKey');
        expect(fetchMock).not.toHaveBeenCalled();
        vi.unstubAllEnvs();
    });

    test('refuses an empty prompt before spending a call on it', async () => {
        await expect(generateImageTool.invoke({prompt: '   '}, contextWithKey()))
            .rejects.toThrow('The prompt of an image cannot be empty.');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('reports what the service complained about', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false, status: 400,
            json: async () => ({code: 'InvalidParameter', message: 'size out of range'}),
        });

        await expect(generateImageTool.invoke({prompt: 'a whale'}, contextWithKey()))
            .rejects.toThrow('Image generation failed (400): size out of range');
        expect(mocks.save).not.toHaveBeenCalled();
    });

    test('reports a rejection that carries no readable body', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false, status: 500, json: async () => { throw new Error('not json'); },
        });

        await expect(generateImageTool.invoke({prompt: 'a whale'}, contextWithKey()))
            .rejects.toThrow('Image generation failed (500): no reason given');
    });

    test('reports an answer that came back without an image', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true, status: 200,
            json: async () => ({output: {choices: []}, request_id: 'req-2'}),
        });

        await expect(generateImageTool.invoke({prompt: 'a whale'}, contextWithKey()))
            .rejects.toThrow('Image generation returned no image, request id req-2.');
    });

    test('reports a link that could not be fetched, since it expires within a day', async () => {
        fetchMock.mockResolvedValueOnce(generated()).mockResolvedValueOnce({ok: false, status: 403});

        await expect(generateImageTool.invoke({prompt: 'a whale'}, contextWithKey()))
            .rejects.toThrow('The generated image could not be downloaded (403): https://oss.example.com/generated.png');
        expect(mocks.save).not.toHaveBeenCalled();
    });
});

describe('generateImageTool invoke with seedream', () => {

    const ARK_URL = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';

    function drawn(imageUrl = 'https://ark.example.com/drawn.png') {
        return {ok: true, status: 200, json: async () => ({model: 'doubao', data: [{url: imageUrl}]})};
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    test('asks ark for the model the agent picked and keeps the bytes it hands back', async () => {
        fetchMock.mockResolvedValueOnce(drawn()).mockResolvedValueOnce(downloaded());

        const result = await generateImageTool.invoke(
            {prompt: 'a whale in a teacup'}, contextWithKey('ark-key', 'doubao-seedream-5-0-260128')
        );

        const [url, request] = fetchMock.mock.calls[0]!;
        expect(url).toBe(ARK_URL);
        expect(request.headers.Authorization).toBe('Bearer ark-key');
        expect(requestBodyOf(0)).toEqual({
            model: 'doubao-seedream-5-0-260128',
            prompt: 'a whale in a teacup',
            response_format: 'url',
            watermark: false,
        });
        expect(fetchMock.mock.calls[1]![0]).toBe('https://ark.example.com/drawn.png');
        expect(result).toContain('dcimg://agent.a1/abcd1234.png');
    });

    /** Sent to dashscope instead, any of them would come back refused as an unknown model. */
    test('takes every seedream choice to ark under its own name', async () => {
        const choices: ImageModel[] = [
            'doubao-seedream-5-0-pro-260628',
            'doubao-seedream-4-5-251128',
            'doubao-seedream-4-0-250828',
        ];
        for (const choice of choices) {
            fetchMock.mockResolvedValueOnce(drawn()).mockResolvedValueOnce(downloaded());
            await generateImageTool.invoke({prompt: 'a whale'}, contextWithKey('k', choice));
            const drawCall = fetchMock.mock.calls.length - 2;
            expect(fetchMock.mock.calls[drawCall]![0]).toBe(ARK_URL);
            expect(requestBodyOf(drawCall).model).toBe(choice);
        }
    });

    test('writes the resolution the way ark spells it', async () => {
        fetchMock.mockResolvedValueOnce(drawn()).mockResolvedValueOnce(downloaded());

        await generateImageTool.invoke(
            {prompt: 'a whale', size: '1664*928'}, contextWithKey('k', 'doubao-seedream-4-0-250828')
        );

        expect(requestBodyOf(0).size).toBe('1664x928');
    });

    /** Ark has no field for it, and inventing one would have the request rejected. */
    test('leaves out what the caller wanted kept out of the picture', async () => {
        fetchMock.mockResolvedValueOnce(drawn()).mockResolvedValueOnce(downloaded());

        await generateImageTool.invoke(
            {prompt: 'a whale', negativePrompt: 'no text'}, contextWithKey('k', 'doubao-seedream-4-0-250828')
        );

        expect(requestBodyOf(0)).not.toHaveProperty('negative_prompt');
    });

    test('falls back to the variable ark reads, not the one dashscope reads', async () => {
        vi.stubEnv('ARK_API_KEY', 'ark-env-key');
        fetchMock.mockResolvedValueOnce(drawn()).mockResolvedValueOnce(downloaded());

        await generateImageTool.invoke({prompt: 'a whale'}, contextWithKey('', 'doubao-seedream-4-0-250828'));

        expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer ark-env-key');
    });

    test('names the variable of the vendor that was picked when no key is around', async () => {
        vi.stubEnv('ARK_API_KEY', '');

        await expect(generateImageTool.invoke({prompt: 'a whale'}, contextWithKey('', 'doubao-seedream-4-0-250828')))
            .rejects.toThrow('agent.tools.image.noKey {"env":"ARK_API_KEY"}');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('reports what ark complained about', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false, status: 400,
            json: async () => ({error: {code: 'InvalidParameter', message: 'size is not supported'}}),
        });

        await expect(generateImageTool.invoke({prompt: 'a whale'}, contextWithKey('k', 'doubao-seedream-4-0-250828')))
            .rejects.toThrow('Image generation failed (400): size is not supported');
        expect(mocks.save).not.toHaveBeenCalled();
    });

    test('reports an answer that came back without an image', async () => {
        fetchMock.mockResolvedValueOnce({ok: true, status: 200, json: async () => ({data: []})});

        await expect(generateImageTool.invoke({prompt: 'a whale'}, contextWithKey('k', 'doubao-seedream-4-0-250828')))
            .rejects.toThrow('Image generation returned no image.');
    });
});

describe('generateImageTool drawing from a picture', () => {

    const ARK_URL = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
    const SOURCE = `data:image/png;base64,${Buffer.from('source-bytes').toString('base64')}`;
    const SEEDREAM: ImageModel = 'doubao-seedream-4-0-250828';

    function drawn() {
        return {ok: true, status: 200, json: async () => ({data: [{url: 'https://ark.example.com/drawn.png'}]})};
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    /** Dashscope wants the picture in the message the prompt travels in, ahead of it. */
    test('hands qwen the bytes behind the reference', async () => {
        fetchMock.mockResolvedValueOnce(generated()).mockResolvedValueOnce(downloaded());

        await generateImageTool.invoke(
            {prompt: 'make it night', sourceImages: ['dcimg://agent.a1/abcd1234.png']}, contextWithKey()
        );

        expect(mocks.read).toHaveBeenCalledExactlyOnceWith('agent.a1/abcd1234.png');
        expect(requestBodyOf(0).input.messages[0].content)
            .toEqual([{image: SOURCE}, {text: 'make it night'}]);
    });

    test('names one picture to ark on its own and several as a list', async () => {
        fetchMock.mockResolvedValueOnce(drawn()).mockResolvedValueOnce(downloaded());
        await generateImageTool.invoke(
            {prompt: 'make it night', sourceImages: ['dcimg://agent.a1/abcd1234.png']},
            contextWithKey('k', SEEDREAM)
        );
        expect(fetchMock.mock.calls[0]![0]).toBe(ARK_URL);
        expect(requestBodyOf(0).image).toBe(SOURCE);

        fetchMock.mockResolvedValueOnce(drawn()).mockResolvedValueOnce(downloaded());
        await generateImageTool.invoke(
            {prompt: 'put them together', sourceImages: ['dcimg://agent.a1/a.png', 'dcimg://agent.a1/b.jpg']},
            contextWithKey('k', SEEDREAM)
        );
        expect(requestBodyOf(2).image).toEqual([SOURCE, `data:image/jpeg;base64,${
            Buffer.from('source-bytes').toString('base64')}`]);
    });

    /** Both vendors fetch a link themselves, so its bytes never have to pass through here. */
    test('hands a link over as it is', async () => {
        fetchMock.mockResolvedValueOnce(drawn()).mockResolvedValueOnce(downloaded());

        await generateImageTool.invoke(
            {prompt: 'make it night', sourceImages: ['https://host/shot.png']}, contextWithKey('k', SEEDREAM)
        );

        expect(mocks.read).not.toHaveBeenCalled();
        expect(requestBodyOf(0).image).toBe('https://host/shot.png');
    });

    test('draws from the prompt alone when no picture was named', async () => {
        fetchMock.mockResolvedValueOnce(drawn()).mockResolvedValueOnce(downloaded());

        await generateImageTool.invoke({prompt: 'a whale'}, contextWithKey('k', SEEDREAM));

        expect(requestBodyOf(0)).not.toHaveProperty('image');
    });

    test('refuses a reference whose bytes the store does not have', async () => {
        mocks.read.mockReturnValueOnce(null);

        await expect(generateImageTool.invoke(
            {prompt: 'make it night', sourceImages: ['dcimg://agent.a1/gone.png']}, contextWithKey()
        )).rejects.toThrow('agent.tools.image.unknownImage {"ref":"dcimg://agent.a1/gone.png"}');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('refuses what is neither a reference nor a link', async () => {
        await expect(generateImageTool.invoke(
            {prompt: 'make it night', sourceImages: ['/home/me/cat.png']}, contextWithKey()
        )).rejects.toThrow('agent.tools.image.unknownImage {"ref":"/home/me/cat.png"}');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    /** A vendor refuses the request outright, so the picture is stopped before it is sent. */
    test('refuses a picture heavier than an image model takes', async () => {
        mocks.read.mockReturnValueOnce(Buffer.alloc(11 * 1024 * 1024));

        await expect(generateImageTool.invoke(
            {prompt: 'make it night', sourceImages: ['dcimg://agent.a1/huge.png']}, contextWithKey()
        )).rejects.toThrow('agent.tools.image.imageTooLarge {"ref":"dcimg://agent.a1/huge.png","size":"11.0","limit":10}');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('generateImageTool metadata', () => {

    test('draws for a chat as well, but never from inside a sub loop', () => {
        expect(generateImageTool.agentMode).toEqual(['agent', 'chat']);
        expect(generateImageTool.parallelSafe).toBe(false);
        expect(generateImageTool.exclusiveInSubLoop).toBe(true);
    });

    test('only offers resolutions the model accepts', () => {
        const properties = generateImageTool.tool.schema.properties as {size: {enum: string[]}};
        expect(properties.size.enum).toContain('1328*1328');
        expect(generateImageTool.tool.schema.required).toEqual(['prompt']);
    });
});
