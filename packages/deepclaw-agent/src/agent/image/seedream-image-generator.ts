import type { ImageModel } from '@deepclaw/config';
import { ImageGenerator, type ImageRequest } from './image-generator';

const GENERATION_URL = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';

/** The choices that speak the ark protocol below. */
export const SEEDREAM_MODELS: readonly ImageModel[] = [
    'doubao-seedream-5-0-pro-260628',
    'doubao-seedream-5-0-260128',
    'doubao-seedream-4-5-251128',
    'doubao-seedream-4-0-250828',
];

type SeedreamAnswer = {
    data?: {url?: string}[];
};

export class SeedreamImageGenerator extends ImageGenerator {

    public static readonly envKey = 'ARK_API_KEY';

    /** Ark takes no negative prompt, so what the answer wanted kept out cannot be passed on. */
    public override async draw(request: ImageRequest): Promise<string> {
        const answer = await this.ask<SeedreamAnswer>(GENERATION_URL, {
            model: this.model,
            prompt: request.prompt,
            ...(request.size ? {size: pixelsOf(request.size)} : {}),
            response_format: 'url',
            watermark: false,
        });
        const image = answer.data?.find(item => item.url)?.url;
        if (!image) {
            throw new Error('Image generation returned no image.');
        }
        return image;
    }
}

/** Ark writes a resolution as 1328x1328 where dashscope writes 1328*1328. */
function pixelsOf(size: string): string {
    return size.replace('*', 'x');
}
