import { imageKeyMediaType, imageRefKey } from '@deepclaw/core';
import { ImageStore } from '@deepclaw/node-utils';

export type ResolvedImage =
    {type: 'url', url: string} |
    {type: 'bytes', mediaType: string, base64: string} |
    {type: 'missing'};

/**
 * History holds an image as a reference; its bytes are only read back here, right before
 * the messages leave for the model. A reference whose bytes are gone stays recognizable
 * so the model can be told about it instead of being sent a url it cannot fetch.
 */
export function resolveImage(url: string): ResolvedImage {
    const key = imageRefKey(url);
    if (!key) {
        return {type: 'url', url};
    }
    const bytes = ImageStore.read(key);
    return bytes
        ? {type: 'bytes', mediaType: imageKeyMediaType(key), base64: bytes.toString('base64')}
        : {type: 'missing'};
}

export function dataUrlOf(image: {mediaType: string, base64: string}): string {
    return `data:${image.mediaType};base64,${image.base64}`;
}

export const IMAGE_UNAVAILABLE = '[image unavailable, its bytes are gone]';
