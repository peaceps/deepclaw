import { FileUtils } from './file-utils';

const IMAGE_DIR = '.images';
const keyRegex = /^(?:[a-zA-Z0-9._-]+\/)?[a-f0-9]+\.[a-z0-9]+$/;

/**
 * Bytes of the images that were sent to or by an agent, filed under the loop they belong to
 * and named after their own hash, so the same picture is only kept once per conversation no
 * matter how many messages point at it.
 */
export class ImageStore {

    public static save(bytes: Buffer, extension: string, loopId: string): string {
        const folder = folderOf(loopId);
        const name = `${FileUtils.hashString(bytes)}.${extension}`;
        const key = folder ? `${folder}/${name}` : name;
        if (!FileUtils.exists(this.pathOf(key))) {
            FileUtils.writeFile(this.pathOf(key), bytes);
        }
        return key;
    }

    /** A key from a session written before the loops had a folder names the file on its own. */
    public static read(key: string): Buffer | null {
        if (!keyRegex.test(key) || key.includes('..')) {
            return null;
        }
        try {
            return FileUtils.readBuffer(this.pathOf(key));
        } catch {
            return null;
        }
    }

    private static pathOf(key: string): string {
        return `${IMAGE_DIR}/${key}`;
    }
}

/** A loop id is made of ids and dots, but a folder has to survive whatever else reaches it. */
function folderOf(loopId: string): string {
    return loopId.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '_');
}
