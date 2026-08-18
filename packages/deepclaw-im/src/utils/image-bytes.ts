import { imageRefKey, isImageName, parseDataUrl } from '@deepclaw/core';
import { FileStore, ImageStore } from '@deepclaw/node-utils';

/**
 * Bytes an IM has to carry itself: a picture of ours lives behind a reference no chat
 * client can follow, and an inlined one only exists in the answer. A linked picture has
 * no bytes here, the IM fetches those from the link.
 */
export function imageBytes(url: string): Buffer | null {
    const key = imageRefKey(url);
    if (key) {
        return ImageStore.read(key);
    }
    // A picture a run handed over is linked through a route of ours, which is a link on this host
    // and no link at all to a chat client somewhere else. Anything else a run filed is linked the
    // same way, and a report written as a picture is no picture to carry into a chat.
    const fileKey = FileStore.keyOf(url);
    if (fileKey) {
        return !isImageName(fileKey) ? null : FileStore.read(fileKey);
    }
    const dataUrl = parseDataUrl(url);
    return dataUrl ? Buffer.from(dataUrl.base64, 'base64') : null;
}
