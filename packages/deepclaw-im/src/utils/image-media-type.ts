const IMAGE_SIGNATURES: {mediaType: string, matches: (bytes: Buffer) => boolean}[] = [
    {mediaType: 'image/png', matches: bytes => bytes.subarray(0, 4).toString('hex') === '89504e47'},
    {mediaType: 'image/jpeg', matches: bytes => bytes.subarray(0, 3).toString('hex') === 'ffd8ff'},
    {mediaType: 'image/gif', matches: bytes => bytes.subarray(0, 4).toString('ascii') === 'GIF8'},
    {mediaType: 'image/webp', matches: bytes =>
        bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'},
];

/**
 * IM download endpoints answer with octet-stream or no type at all, so the bytes
 * decide. The content type is only trusted when the bytes say nothing.
 */
export function imageMediaType(bytes: Buffer, contentType?: string | null): string {
    const signature = IMAGE_SIGNATURES.find(({matches}) => matches(bytes));
    if (signature) {
        return signature.mediaType;
    }
    return contentType?.startsWith('image/') ? contentType : 'image/jpeg';
}
