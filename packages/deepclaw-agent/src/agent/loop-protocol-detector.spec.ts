import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {detectAgentProtocolFromUrl, detectAgentSDKFromRequest} from './loop-protocol-detector';

describe('detectAgentProtocolFromUrl', () => {

    test('reads anthropic out of the host', () => {
        expect(detectAgentProtocolFromUrl('https://api.anthropic.com')).toBe('Anthropic');
    });

    test('falls back to the openai chat protocol for any other host', () => {
        expect(detectAgentProtocolFromUrl('https://api.openai.com/v1')).toBe('OpenAIChat');
        expect(detectAgentProtocolFromUrl('http://localhost:11434/v1')).toBe('OpenAIChat');
    });

    test('ignores the case of the url', () => {
        expect(detectAgentProtocolFromUrl('HTTPS://API.ANTHROPIC.COM')).toBe('Anthropic');
    });

    test('ignores a trailing slash', () => {
        expect(detectAgentProtocolFromUrl('https://api.anthropic.com/')).toBe('Anthropic');
    });

    test('gives up on an empty url', () => {
        expect(detectAgentProtocolFromUrl('')).toBeNull();
        expect(detectAgentProtocolFromUrl('/')).toBeNull();
    });

    test('gives up on something that is not a url', () => {
        expect(detectAgentProtocolFromUrl('api.openai.com')).toBeNull();
        expect(detectAgentProtocolFromUrl('not a url')).toBeNull();
    });
});

describe('detectAgentSDKFromRequest', () => {
    const fetchMock = vi.fn<typeof fetch>();

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function response(status: number): Response {
        return {status} as Response;
    }

    test('picks openai when the models endpoint answers', async () => {
        fetchMock.mockResolvedValue(response(200));
        expect(await detectAgentSDKFromRequest('https://api.example.com/v1', 'key')).toBe('OpenAIChat');
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0]![0]).toBe('https://api.example.com/v1/models');
    });

    test('picks openai even for an unauthorized answer', async () => {
        fetchMock.mockResolvedValue(response(401));
        expect(await detectAgentSDKFromRequest('https://api.example.com/v1', '')).toBe('OpenAIChat');
    });

    test('falls back to anthropic when there is no models endpoint', async () => {
        fetchMock.mockResolvedValueOnce(response(404)).mockResolvedValueOnce(response(400));
        expect(await detectAgentSDKFromRequest('https://api.example.com', 'key')).toBe('Anthropic');
        expect(fetchMock.mock.calls[1]![0]).toBe('https://api.example.com/messages');
    });

    test('tries anthropic when the models endpoint rejects the method', async () => {
        fetchMock.mockResolvedValueOnce(response(405)).mockResolvedValueOnce(response(200));
        expect(await detectAgentSDKFromRequest('https://api.example.com', 'key')).toBe('Anthropic');
    });

    test('tries anthropic when the models request throws', async () => {
        fetchMock.mockRejectedValueOnce(new Error('dns failure')).mockResolvedValueOnce(response(200));
        expect(await detectAgentSDKFromRequest('https://api.example.com', 'key')).toBe('Anthropic');
    });

    test('gives up when neither endpoint exists', async () => {
        fetchMock.mockResolvedValue(response(404));
        expect(await detectAgentSDKFromRequest('https://api.example.com', 'key')).toBeNull();
    });

    test('gives up when every request fails', async () => {
        fetchMock.mockRejectedValue(new Error('unreachable'));
        expect(await detectAgentSDKFromRequest('https://api.example.com', 'key')).toBeNull();
    });

    test('drops a trailing slash before building the endpoints', async () => {
        fetchMock.mockResolvedValue(response(200));
        await detectAgentSDKFromRequest('https://api.example.com/v1/', 'key');
        expect(fetchMock.mock.calls[0]![0]).toBe('https://api.example.com/v1/models');
    });

    test('sends the api key as a bearer token to openai', async () => {
        fetchMock.mockResolvedValue(response(200));
        await detectAgentSDKFromRequest('https://api.example.com', 'secret');
        expect(fetchMock.mock.calls[0]![1]).toEqual({headers: {Authorization: 'Bearer secret'}});
    });

    test('sends no authorization header without an api key', async () => {
        fetchMock.mockResolvedValue(response(200));
        await detectAgentSDKFromRequest('https://api.example.com', '');
        expect(fetchMock.mock.calls[0]![1]).toEqual({headers: {}});
    });

    test('probes anthropic with its own header and a minimal message', async () => {
        fetchMock.mockResolvedValueOnce(response(404)).mockResolvedValueOnce(response(200));
        await detectAgentSDKFromRequest('https://api.example.com', 'secret');
        const [, init] = fetchMock.mock.calls[1]!;
        expect(init).toMatchObject({
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01',
                'x-api-key': 'secret',
            },
        });
        expect(JSON.parse(init!.body as string)).toEqual({
            model: 'test', max_tokens: 1, messages: [{role: 'user', content: 'hello'}]
        });
    });
});
