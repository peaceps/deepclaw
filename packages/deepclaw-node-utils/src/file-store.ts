import fs from 'fs';
import path from 'path';
import { FileUtils } from './file-utils';

/** Where the files are asked for, the half of the mapping that a key is the other half of. */
const URL_PREFIX = '/api/file/';

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
        return `${URL_PREFIX}${key.split('/').map(encodeURIComponent).join('/')}`;
    }

    /**
     * The key behind a url of ours, or null for any other url. A browser follows such a link by
     * itself, whoever has to carry the bytes somewhere else has to find them again from here.
     */
    public static keyOf(url: string): string | null {
        if (!url.startsWith(URL_PREFIX)) {
            return null;
        }
        try {
            return url.slice(URL_PREFIX.length).split('/').map(decodeURIComponent).join('/');
        } catch {
            // A stray percent sign is no escape, and no key of ours either.
            return null;
        }
    }

    /**
     * The path a url of ours was made from, or null for any other url. A link is how a file
     * reaches the user, and nothing an agent can follow: it opens the file where it lies. Whether
     * anything lies there is left to whoever opens it, this is the name of a place and no visit.
     */
    public static fileOf(url: string): string | null {
        const key = this.keyOf(url);
        return key && this.pathOf(key) ? `.${key}` : null;
    }

    public static read(key: string): Buffer | null {
        const path = this.pathOf(key);
        if (!path) {
            return null;
        }
        try {
            return fs.readFileSync(path);
        } catch {
            return null;
        }
    }

    /**
     * What tells a browser its copy is still the file, out of what changes when the file does. A
     * name here is reused by the run that writes the file again, so the bytes cannot be held on to
     * on the strength of the name alone.
     */
    public static tagOf(key: string): string | null {
        const path = this.pathOf(key);
        if (!path) {
            return null;
        }
        try {
            const stat = fs.statSync(path);
            return !stat.isFile() ? null : `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
        } catch {
            return null;
        }
    }

    /** What a browser should make of the bytes, guessed from the name as everything else does. */
    public static mediaTypeOf(name: string): string {
        return MEDIA_TYPES[name.split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream';
    }

    /**
     * The file a key names, or null for a key that names none of ours. It is read as it lies
     * rather than under a name cleaned up for writing: a run writes into the folder with a shell
     * of its own, and the characters that writing through us drops are the file here.
     *
     * What a key is allowed to be cannot be settled by reading it, only by resolving it and asking
     * what came out: every separator, on this system and on the next one, is the business of the
     * one who resolves. A key that comes back as it went in walks nowhere, and one that comes back
     * as something else is refused whatever it did to get there. So a name may carry two dots in
     * the middle of it, and a step out of the folders that are served survives no comparison.
     */
    private static pathOf(key: string): string | null {
        // A backslash separates on Windows, and is a rare thing to name a file with anywhere else.
        if (key.includes('\\') || !SERVED.test(key)) {
            return null;
        }
        const file = FileUtils.getAbsolutePath(`.${key}`);
        const inside = path.relative(FileUtils.getWorkingDir(), file).replace(/\\/g, '/');
        return inside === `.${key}` ? file : null;
    }
}
