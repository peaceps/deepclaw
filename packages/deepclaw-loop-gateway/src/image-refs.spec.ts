import {beforeEach, describe, expect, test, vi} from 'vitest';
import { storeImages } from './image-refs';

const mocks = vi.hoisted(() => ({
    save: vi.fn<(bytes: Buffer, extension: string, loopId: string) => string>(() => 'agent.a1/abc123.png'),
}));

vi.mock('@deepclaw/node-utils', () => ({
    ImageStore: {save: mocks.save},
}));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.save.mockReturnValue('agent.a1/abc123.png');
});

describe('storeImages', () => {

    test('keeps the bytes of an inline image and answers with a reference to them', () => {
        expect(storeImages('agent.a1', [{url: 'data:image/png;base64,QUJD', mediaType: 'image/png'}]))
            .toEqual([{url: 'dcimg://agent.a1/abc123.png', mediaType: 'image/png'}]);
        expect(mocks.save).toHaveBeenCalledExactlyOnceWith(Buffer.from('ABC'), 'png', 'agent.a1');
    });

    test('reads the type out of the url when the caller named none', () => {
        storeImages('agent.a1', [{url: 'data:image/webp;base64,QUJD'}]);
        expect(mocks.save).toHaveBeenCalledExactlyOnceWith(Buffer.from('ABC'), 'webp', 'agent.a1');
    });

    test('leaves a link alone', () => {
        const images = [{url: 'https://host/shot.png'}];
        expect(storeImages('agent.a1', images)).toEqual(images);
        expect(mocks.save).not.toHaveBeenCalled();
    });

    test('leaves an image that already is a reference alone', () => {
        const images = [{url: 'dcimg://agent.a1/abc123.png', mediaType: 'image/png'}];
        expect(storeImages('agent.a1', images)).toEqual(images);
        expect(mocks.save).not.toHaveBeenCalled();
    });

    test('has nothing to do without images', () => {
        expect(storeImages('agent.a1', undefined)).toBeUndefined();
        expect(mocks.save).not.toHaveBeenCalled();
    });
});
