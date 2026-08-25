import type { ImageModel } from '@deepclaw/config';
import { imageKeyExtension, parseDataUrl } from '@deepclaw/core';
import { ImageGenerator, pixelsOf, type ImageRequest } from './image-generator';

const GENERATION_URL = 'https://api.openai.com/v1/images/generations';
/** Drawing from a picture is a different endpoint here, not a field of the one above. */
const EDIT_URL = 'https://api.openai.com/v1/images/edits';

const SOURCE_TIMEOUT_MS = 60_000;

/** The choices that speak the openai protocol below. */
export const GPT_IMAGE_MODELS: readonly ImageModel[] = [
    'gpt-image-2',
];

type GptImageAnswer = {
    data?: {b64_json?: string}[];
};

export class GptImageGenerator extends ImageGenerator {

    public static readonly envKey = 'OPENAI_API_KEY';

    /** Openai takes no negative prompt, so what the answer wanted kept out cannot be passed on. */
    public override async draw(request: ImageRequest, signal?: AbortSignal): Promise<string> {
        const images = request.images || [];
        const answer = images.length
            ? await this.askForm<GptImageAnswer>(
                EDIT_URL, await editForm(this.model, request, images, signal), signal
            )
            : await this.ask<GptImageAnswer>(GENERATION_URL, {
                model: this.model,
                prompt: request.prompt,
                ...(request.size ? {size: pixelsOf(request.size)} : {}),
            }, signal);
        const image = answer.data?.find(item => item.b64_json)?.b64_json;
        if (!image) {
            throw new Error('Image generation returned no image.');
        }
        // openai hands the picture back inline, and png is what it draws unless asked otherwise
        return `data:image/png;base64,${image}`;
    }
}

async function editForm(
    model: string, request: ImageRequest, images: string[], signal?: AbortSignal
): Promise<FormData> {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', request.prompt);
    if (request.size) {
        form.append('size', pixelsOf(request.size));
    }
    for (const [index, image] of images.entries()) {
        const {bytes, mediaType} = await bytesOf(image, signal);
        form.append('image[]',
            new Blob([new Uint8Array(bytes)], {type: mediaType}),
            `source-${index}.${extensionOf(mediaType)}`);
    }
    return form;
}

/** The edit endpoint reads the bytes off the request, so a link is fetched before it is sent on. */
async function bytesOf(
    image: string, signal?: AbortSignal
): Promise<{bytes: Buffer, mediaType: string}> {
    const inline = parseDataUrl(image);
    if (inline) {
        return {bytes: Buffer.from(inline.base64, 'base64'), mediaType: inline.mediaType};
    }
    const timeout = AbortSignal.timeout(SOURCE_TIMEOUT_MS);
    const response = await fetch(image, {
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout
    });
    if (!response.ok) {
        throw new Error(`The picture to draw from could not be read (${response.status}): ${image}`);
    }
    return {
        bytes: Buffer.from(await response.arrayBuffer()),
        mediaType: response.headers.get('content-type') || 'image/png',
    };
}

/** Only a png, a webp or a jpeg is drawn from, so an unnamed type is offered as the usual one. */
function extensionOf(mediaType: string): string {
    const extension = imageKeyExtension(mediaType);
    return extension === 'bin' ? 'png' : extension;
}
