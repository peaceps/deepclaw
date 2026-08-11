import {beforeEach, describe, expect, test, vi} from 'vitest';
import {GET} from './route';

const mocks = vi.hoisted(() => ({
    read: vi.fn<(key: string) => Buffer | null>(),
}));

vi.mock('@deepclaw/node-utils', () => ({
    ImageStore: {read: mocks.read},
}));

function get(key: string): Promise<Response> {
    return GET(new Request(`http://localhost/api/image/${key}`), {params: Promise.resolve({key})});
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('image endpoint', () => {

    test('serves the bytes of the key with the type they were stored as', async () => {
        mocks.read.mockReturnValue(Buffer.from('the image'));
        const response = await get('abc123.png');
        expect(mocks.read).toHaveBeenCalledWith('abc123.png');
        expect(response.headers.get('Content-Type')).toBe('image/png');
        expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from('the image'));
    });

    test('lets the browser keep the bytes forever, the name is their hash', async () => {
        mocks.read.mockReturnValue(Buffer.from('the image'));
        expect((await get('abc123.png')).headers.get('Cache-Control')).toContain('immutable');
    });

    test('answers with nothing for a key the store does not have', async () => {
        mocks.read.mockReturnValue(null);
        expect((await get('abc123.png')).status).toBe(404);
    });
});
