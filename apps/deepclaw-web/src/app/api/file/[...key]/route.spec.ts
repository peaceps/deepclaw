import {beforeEach, describe, expect, test, vi} from 'vitest';
import {GET} from './route';

const mocks = vi.hoisted(() => ({
    read: vi.fn<(key: string) => Buffer | null>(),
    tagOf: vi.fn<(key: string) => string | null>(),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => {
    const original = await importOriginal<typeof import('@deepclaw/node-utils')>();
    return {
        ...original,
        FileStore: {
            read: mocks.read,
            tagOf: mocks.tagOf,
            // What a name comes down to is knowledge of the store, not of the route.
            mediaTypeOf: original.FileStore.mediaTypeOf.bind(original.FileStore),
        },
    };
});

function get(key: string, headers: Record<string, string> = {}): Promise<Response> {
    return GET(
        new Request(`http://localhost/api/file/${key}`, {headers}),
        {params: Promise.resolve({key: key.split('/').map(decodeURIComponent)})}
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.read.mockReturnValue(Buffer.from('the report'));
    mocks.tagOf.mockReturnValue('"2a-17b"');
});

describe('file endpoint', () => {

    test('serves the bytes of the key with the type its name says', async () => {
        const response = await get('projects/p1/files/report.pdf');
        expect(mocks.read).toHaveBeenCalledWith('projects/p1/files/report.pdf');
        expect(response.headers.get('Content-Type')).toBe('application/pdf');
        expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from('the report'));
    });

    /** The name is the one the user asked the run for, and a header carries no raw space. */
    test('names the file it serves the way a header can carry it', async () => {
        const response = await get('projects/p1/files/Q3%20report.pdf');
        expect(response.headers.get('Content-Disposition'))
            .toBe("inline; filename*=UTF-8''Q3%20report.pdf");
    });

    test('answers with nothing for a key the store does not serve', async () => {
        mocks.tagOf.mockReturnValue(null);
        expect((await get('agents/a1/SOUL.json')).status).toBe(404);
        expect(mocks.read).not.toHaveBeenCalled();
    });

    test('answers with nothing for a file that went away between the two reads', async () => {
        mocks.read.mockReturnValue(null);
        expect((await get('projects/p1/files/report.pdf')).status).toBe(404);
    });

    describe('holding a file', () => {

        test('names the bytes so the browser can ask whether they changed', async () => {
            expect((await get('projects/p1/files/report.pdf')).headers.get('ETag')).toBe('"2a-17b"');
        });

        /** A run writes the file again under the same name, so the name alone proves nothing. */
        test('has the browser ask every time rather than trust the name', async () => {
            expect((await get('projects/p1/files/report.pdf')).headers.get('Cache-Control'))
                .toBe('no-cache');
        });

        test('sends no bytes to a browser that already has these', async () => {
            const response = await get('projects/p1/files/chart.png', {'if-none-match': '"2a-17b"'});
            expect(response.status).toBe(304);
            expect(mocks.read).not.toHaveBeenCalled();
        });

        test('sends the bytes to a browser holding an older copy', async () => {
            const response = await get('projects/p1/files/chart.png', {'if-none-match': '"11-1"'});
            expect(response.status).toBe(200);
        });
    });

    describe('a file written by a model', () => {

        test('is never run as something other than what it says it is', async () => {
            expect((await get('projects/p1/files/report.pdf')).headers.get('X-Content-Type-Options'))
                .toBe('nosniff');
        });

        /** Served from our origin, a page of the run could read everything the user keeps here. */
        test('is left an origin of its own when it is a page', async () => {
            const response = await get('projects/p1/files/report.html');
            expect(response.headers.get('Content-Security-Policy')).toBe('sandbox allow-scripts');
        });

        /** A sandbox turns the viewer of the browser into a download, and a pdf runs nothing. */
        test('is shown as it is when it is nothing that runs', async () => {
            const response = await get('projects/p1/files/report.pdf');
            expect(response.headers.get('Content-Security-Policy')).toBeNull();
        });
    });
});
