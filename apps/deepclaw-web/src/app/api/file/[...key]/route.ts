import { FileStore } from '@deepclaw/node-utils';

/** A file handed over by a run, named by the folder of the project or cron task it came out of. */
export async function GET(_request: Request, {params}: {params: Promise<{key: string[]}>}) {
    const key = (await params).key.join('/');
    const bytes = FileStore.read(key);
    if (!bytes) {
        return new Response(null, {status: 404});
    }
    const name = key.split('/').pop() || 'file';
    return new Response(new Uint8Array(bytes), {
        headers: {
            'Content-Type': FileStore.mediaTypeOf(name),
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
            // a file keeps its name while a run writes it again, so nothing here may be held on to
            'Cache-Control': 'no-store',
        },
    });
}
