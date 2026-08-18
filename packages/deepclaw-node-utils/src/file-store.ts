import { FileUtils } from './file-utils';

/**
 * What may be handed out, named where it is served rather than where it is written: a route that
 * reads whatever path it is asked for is a route that reads the whole data root. The leading dot
 * of the folder is dropped on the way out, so a url stays a url.
 */
const SERVED = /^(projects|cron)\/[^/]+\/(files|output)\/.+$/;

const MEDIA_TYPES: Record<string, string> = {
    md: 'text/markdown; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    json: 'application/json; charset=utf-8',
    html: 'text/html; charset=utf-8',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    zip: 'application/zip',
};

/**
 * The files a run hands to the user. They stay beside the project or the scheduled task they came
 * out of, under the data root, and reach the browser through a route: the folder a web server
 * happens to serve is not the folder an agent writes into, and a copy into it only holds where
 * both are the same checkout.
 */
export class FileStore {

    /** The url of a file already written, by the path it was written under. */
    public static urlOf(path: string): string {
        const key = path.startsWith('.') ? path.slice(1) : path;
        return `/api/file/${key.split('/').map(encodeURIComponent).join('/')}`;
    }

    public static read(key: string): Buffer | null {
        const path = `.${key}`;
        if (key.includes('..') || !SERVED.test(key)
            || !FileUtils.isPathInside(FileUtils.getWorkingDir(), path)) {
            return null;
        }
        try {
            return FileUtils.readBuffer(path);
        } catch {
            return null;
        }
    }

    /** What a browser should make of the bytes, guessed from the name as everything else does. */
    public static mediaTypeOf(name: string): string {
        return MEDIA_TYPES[name.split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream';
    }
}
