import { imageKeyExtension, newImageRef, parseDataUrl, type ImageContent } from "@deepclaw/core";
import { ImageStore } from "@deepclaw/node-utils";

/**
 * Moves the bytes of every inline image into the image store and keeps only a reference,
 * so neither the chat history nor the session file ever holds a base64 payload. Images
 * that already are a reference or a plain link are left alone, and storing the same
 * picture twice is free.
 */
export function storeImages(loopId: string, images?: ImageContent[]): ImageContent[] | undefined {
    return images?.map(image => {
        const dataUrl = parseDataUrl(image.url);
        if (!dataUrl) {
            return image;
        }
        const mediaType = image.mediaType || dataUrl.mediaType;
        const key = ImageStore.save(
            Buffer.from(dataUrl.base64, 'base64'), imageKeyExtension(mediaType), loopId
        );
        return {url: newImageRef(key), mediaType};
    });
}
