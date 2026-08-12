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

    public override async draw(request: ImageRequest): Promise<string> {
        const answer = await this.ask<QwenAnswer>(GENERATION_URL, {
            model: this.model,
            input: {messages: [{role: 'user', content: [{text: request.prompt}]}]},
            parameters: {
                ...(request.negativePrompt ? {negative_prompt: request.negativePrompt} : {}),
                ...(request.size ? {size: request.size} : {}),
                prompt_extend: true,
                watermark: false,
            },
        });
        const image = answer.output?.choices?.[0]?.message?.content?.find(part => part.image)?.image;
        if (!image) {
            throw new Error(`Image generation returned no image, request id ${answer.request_id || 'unknown'}.`);
        }
        return image;
    }
}
