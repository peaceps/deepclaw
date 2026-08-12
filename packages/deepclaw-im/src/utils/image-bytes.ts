import { imageRefKey, parseDataUrl } from '@deepclaw/core';
import { ImageStore } from '@deepclaw/node-utils';

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
    const dataUrl = parseDataUrl(url);
    return dataUrl ? Buffer.from(dataUrl.base64, 'base64') : null;
}
