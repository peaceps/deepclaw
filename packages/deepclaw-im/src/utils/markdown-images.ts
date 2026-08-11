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
