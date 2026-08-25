import type { ImageModel } from '@deepclaw/config';
import { ImageGenerator, type ImageRequest } from './image-generator';

const GENERATION_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

/** The choices that speak the dashscope protocol below. */
export const QWEN_MODELS: readonly ImageModel[] = [
    'qwen-image-3.0',
    'qwen-image-2.0-pro-2026-06-22',
];

type QwenAnswer = {
    output?: {choices?: {message?: {content?: {image?: string}[]}}[]};
    request_id?: string;
};

export class QwenImageGenerator extends ImageGenerator {

    public static readonly envKey = 'DASHSCOPE_API_KEY';

    /** A picture to draw from travels in the same message as the prompt, ahead of it. */
    public override async draw(request: ImageRequest, signal?: AbortSignal): Promise<string> {
        const content = [...(request.images || []).map(image => ({image})), {text: request.prompt}];
        const answer = await this.ask<QwenAnswer>(GENERATION_URL, {
            model: this.model,
            input: {messages: [{role: 'user', content}]},
            parameters: {
                ...(request.negativePrompt ? {negative_prompt: request.negativePrompt} : {}),
                ...(request.size ? {size: request.size} : {}),
                prompt_extend: true,
                watermark: false,
            },
        }, signal);
        const image = answer.output?.choices?.[0]?.message?.content?.find(part => part.image)?.image;
        if (!image) {
            throw new Error(`Image generation returned no image, request id ${answer.request_id || 'unknown'}.`);
        }
        return image;
    }
}
