import { FileUtils } from './file-utils';

const IMAGE_DIR = '.images';
const keyRegex = /^[a-f0-9]+\.[a-z0-9]+$/;

/**
 * Bytes of the images that were sent to or by an agent, named after their own hash so
 * the same picture is only kept once no matter how many messages point at it.
 */
export class ImageStore {

    public static save(bytes: Buffer, extension: string): string {
        const key = `${FileUtils.hashString(bytes)}.${extension}`;
        if (!FileUtils.exists(this.pathOf(key))) {
            FileUtils.writeFile(this.pathOf(key), bytes);
        }
        return key;
    }

    public static read(key: string): Buffer | null {
        if (!keyRegex.test(key)) {
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
