const IMAGE_REF_SCHEME = 'dcimg://';

const dataUrlRegex = /^data:([^;,]*)[^,]*,([\s\S]*)$/;

const EXTENSIONS: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
};

const MEDIA_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
};

/**
 * An image is kept out of the chat history as a reference to its bytes, so a session
 * file stays a few dozen bytes per image instead of a megabyte of base64. The bytes
 * are only read back when a message is about to be handed to a model or a browser.
 */
export function newImageRef(key: string): string {
    return `${IMAGE_REF_SCHEME}${key}`;
}

/** The key of the stored bytes, or null when the url is not a reference. */
export function imageRefKey(url: string): string | null {
    return url.startsWith(IMAGE_REF_SCHEME) ? url.slice(IMAGE_REF_SCHEME.length) : null;
}

export function isImageRef(url: string): boolean {
    return url.startsWith(IMAGE_REF_SCHEME);
}

export function imageKeyExtension(mediaType: string): string {
    return EXTENSIONS[mediaType.toLowerCase()] || 'bin';
}

export function imageKeyMediaType(key: string): string {
    const extension = key.split('.').pop()?.toLowerCase() || '';
    return MEDIA_TYPES[extension] || 'application/octet-stream';
}

/**
 * The extension a file of this name would be stored under, or null for a name that is no picture.
 * A jpeg and a jpg are the same picture to everything downstream, so both arrive as one extension.
 */
export function imageExtensionOf(name: string): string | null {
    const mediaType = MEDIA_TYPES[name.split('.').pop()?.toLowerCase() || ''];
    return mediaType ? EXTENSIONS[mediaType]! : null;
}

/** Whether a name is the name of a picture, for whoever asks that and not what it is kept as. */
export function isImageName(name: string): boolean {
    return imageExtensionOf(name) !== null;
}

/** Splits `data:image/png;base64,QUJD` into its media type and its payload. */
export function parseDataUrl(url: string): {mediaType: string, base64: string} | null {
    const dataUrl = dataUrlRegex.exec(url);
    return dataUrl ? {mediaType: dataUrl[1] || '', base64: dataUrl[2] || ''} : null;
}
