import type { ImageModel } from '@deepclaw/config';
import { ImageGenerator, pixelsOf, type ImageRequest } from './image-generator';

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
        const images = request.images || [];
        const answer = await this.ask<SeedreamAnswer>(GENERATION_URL, {
            model: this.model,
            prompt: request.prompt,
            // one picture to draw from is named on its own, several are named as a list
            ...(images.length ? {image: images.length === 1 ? images[0] : images} : {}),
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
