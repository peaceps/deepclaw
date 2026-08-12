import type { ImageContent } from '@deepclaw/core';

const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;

export type ParsedContent = {
    text: string;
    images: ImageContent[];
}

/**
 * Extract markdown image syntax ![alt](url) from content.
 * Returns the text with image references removed and a list of extracted images.
 */
export function extractMarkdownImages(content: string): ParsedContent {
    const images: ImageContent[] = [];
    const text = content.replace(markdownImageRegex, (_, __: string, url: string) => {
        images.push({ url, mediaType: undefined });
        return '';
    }).trim();
    return { text, images };
}

/**
 * Hand every image url to `urlOf` and put back what it answers, so a picture keeps the
 * place the answer gave it. An image is dropped from the text when the answer is null.
 */
export async function replaceMarkdownImages(
    content: string, urlOf: (url: string) => Promise<string | null>
): Promise<string> {
    let text = '';
    let handled = 0;
    for (const image of content.matchAll(markdownImageRegex)) {
        const url = await urlOf(image[2]!);
        text += content.slice(handled, image.index);
        if (url !== null) {
            text += `![${image[1]}](${url})`;
        }
        handled = image.index + image[0].length;
    }
    return (text + content.slice(handled)).trim();
}
