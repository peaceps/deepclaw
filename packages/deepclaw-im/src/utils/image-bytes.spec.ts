import {beforeEach, describe, expect, test, vi} from 'vitest';
import {newImageRef} from '@deepclaw/core';
import {imageBytes} from './image-bytes';

const mocks = vi.hoisted(() => ({
    readImage: vi.fn<(key: string) => Buffer | null>(),
    readFile: vi.fn<(key: string) => Buffer | null>(),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => {
    const original = await importOriginal<typeof import('@deepclaw/node-utils')>();
    return {
        ...original,
        ImageStore: {read: mocks.readImage},
        FileStore: {
            read: mocks.readFile,
            // What key a url of ours names is knowledge of the store, and pure.
            keyOf: original.FileStore.keyOf.bind(original.FileStore),
        },
    };
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.readImage.mockReturnValue(Buffer.from('the picture'));
    mocks.readFile.mockReturnValue(Buffer.from('the chart'));
});

describe('imageBytes', () => {

    test('reads the picture a reference of ours stands for', () => {
        expect(imageBytes(newImageRef('agent.a1/abc123.png'))).toEqual(Buffer.from('the picture'));
        expect(mocks.readImage).toHaveBeenCalledWith('agent.a1/abc123.png');
    });

    /** A run hands its pictures over as files now, and a chat client cannot follow that link. */
    test('reads a picture a run handed over from where it was filed', () => {
        expect(imageBytes('/api/file/projects/p1/files/chart.png')).toEqual(Buffer.from('the chart'));
        expect(mocks.readFile).toHaveBeenCalledWith('projects/p1/files/chart.png');
    });

    test('reads one handed over under a name a url cannot carry', () => {
        imageBytes('/api/file/projects/p1/files/Q3%20chart.png');
        expect(mocks.readFile).toHaveBeenCalledWith('projects/p1/files/Q3 chart.png');
    });

    test('decodes a picture that only exists in the answer', () => {
        expect(imageBytes('data:image/png;base64,QUJD')).toEqual(Buffer.from('ABC'));
    });

    /** The chat client fetches such a picture itself, there is nothing to carry for it. */
    test('carries nothing for a picture that hangs somewhere else', () => {
        expect(imageBytes('https://host/shot.png')).toBeNull();
        expect(mocks.readFile).not.toHaveBeenCalled();
        expect(mocks.readImage).not.toHaveBeenCalled();
    });
});
