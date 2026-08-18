import { FileStore } from '@deepclaw/node-utils';

/** A file handed over by a run, named by the folder of the project or cron task it came out of. */
export async function GET(request: Request, {params}: {params: Promise<{key: string[]}>}) {
    const key = (await params).key.join('/');
    const tag = FileStore.tagOf(key);
    if (!tag) {
        return new Response(null, {status: 404});
    }
    if (request.headers.get('if-none-match') === tag) {
        return new Response(null, {status: 304, headers: headersOf(key, tag)});
    }
    const bytes = FileStore.read(key);
    if (!bytes) {
        return new Response(null, {status: 404});
    }
    return new Response(new Uint8Array(bytes), {headers: headersOf(key, tag)});
}

function headersOf(key: string, tag: string): Record<string, string> {
    const name = key.split('/').pop() || 'file';
    const mediaType = FileStore.mediaTypeOf(name);
    return {
        'Content-Type': mediaType,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
        // guessing the type of a file whose name a model chose is guessing what it may run as
        'X-Content-Type-Options': 'nosniff',
        ...(runs(mediaType) ? {'Content-Security-Policy': 'sandbox allow-scripts'} : {}),
        // a file keeps its name while a run writes it again, so the browser has to ask every time
        'Cache-Control': 'no-cache',
        'ETag': tag,
    };
}

/**
 * Whether a browser runs the bytes rather than showing them. What a run hands over is written by
 * a model out of pages it read, and served from the origin of the app: a page of that origin can
 * read everything the user keeps here. The sandbox leaves it an origin of its own, where its
 * scripts are welcome to run and reach nothing of ours. Only what runs is put there, a viewer for
 * a pdf is part of the browser and a sandbox turns it into a download.
 */
function runs(mediaType: string): boolean {
    return mediaType.startsWith('text/html') || mediaType.includes('svg');
}
