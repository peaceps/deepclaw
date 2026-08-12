import { imageKeyMediaType } from '@deepclaw/core';
import { ImageStore } from '@deepclaw/node-utils';

/** A key names the loop the picture belongs to, so it arrives here as a path of its own. */
export async function GET(_request: Request, {params}: {params: Promise<{key: string[]}>}) {
    const key = (await params).key.join('/');
    const bytes = ImageStore.read(key);
    if (!bytes) {
        return new Response(null, {status: 404});
    }
    return new Response(new Uint8Array(bytes), {
        headers: {
            'Content-Type': imageKeyMediaType(key),
            // the name of the file is the hash of its bytes, so it can never go stale
            'Cache-Control': 'public, max-age=31536000, immutable',
        },
    });
}
