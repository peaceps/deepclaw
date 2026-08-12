import type { ImageModel } from '@deepclaw/config';
import { imageKeyExtension, newImageRef } from '@deepclaw/core';
import { i18nInstance } from '@deepclaw/i18n';
import { ImageStore } from '@deepclaw/node-utils';
import { ImageGenerator } from '../../image/image-generator';
import { QWEN_MODELS, QwenImageGenerator } from '../../image/qwen-image-generator';
import { SEEDREAM_MODELS, SeedreamImageGenerator } from '../../image/seedream-image-generator';
import { OneLoopContext } from '../../definitions/definitions';
import { ToolDesc } from '../../definitions/tool-definitions';

const DOWNLOAD_TIMEOUT_MS = 60_000;

const SIZES = ['1328*1328', '1664*928', '928*1664', '1472*1104', '1104*1472'] as const;

type GenerateImageInput = {
    prompt: string;
    negativePrompt?: string;
    size?: typeof SIZES[number];
};

export const generateImageTool: ToolDesc<GenerateImageInput> = {
    tool: {
        name: 'generate_image',
        description: `Generate an image from a text description with the image model of this agent.
Describe the subject, the composition, the style and any text that should appear in the image;
prompts in English and Chinese both work.
The result is a reference to the picture, which is how the image is shown to the user.
If the tool failed, display the failed reason to user and stop, do not use other scripts to generate image.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                prompt: {
                    type: 'string',
                    description: 'What the image should show. The longer and more concrete, the closer the result.',
                    minLength: 1,
                },
                negativePrompt: {
                    type: 'string',
                    description: 'What must not appear in the image. Not every model takes one.',
                    maxLength: 500,
                },
                size: {
                    type: 'string',
                    enum: [...SIZES],
                    description: 'Resolution. Omit it to let the model pick one that fits the prompt.',
                },
            },
            required: ['prompt'],
        },
    },
    agentMode: ['agent', 'chat'],
    parallelSafe: false,
    exclusiveInSubLoop: true,
    invoke: async function(input: GenerateImageInput, context: OneLoopContext): Promise<string> {
        const prompt = input.prompt?.trim();
        if (!prompt) {
            throw new Error('The prompt of an image cannot be empty.');
        }
        const choice = context.loopConfig.llm.imageModel;
        if (!choice) {
            throw new Error(i18nInstance.t('agent.tools.image.noModel'));
        }
        const generator = generatorOf(choice, context.loopConfig.llm.imageApiKey);
        const key = await store(await generator.draw({...input, prompt}), context.loopId);
        return i18nInstance.t('agent.tools.image.saved', {url: newImageRef(key)});
    },
};

/**
 * Which vendor draws the picture is the user's call, never ours: their key belongs to one of
 * them and a guess here would spend it somewhere they never chose.
 */
function generatorOf(choice: ImageModel, configuredKey?: string): ImageGenerator {
    if (QWEN_MODELS.includes(choice)) {
        return new QwenImageGenerator(choice, keyOf(configuredKey, QwenImageGenerator.envKey));
    }
    if (SEEDREAM_MODELS.includes(choice)) {
        return new SeedreamImageGenerator(choice, keyOf(configuredKey, SeedreamImageGenerator.envKey));
    }
    throw new Error(i18nInstance.t('agent.tools.image.unsupportedModel', {model: choice}));
}

/** Each vendor reads its own variable, so the fallback belongs to the one that was picked. */
function keyOf(configured: string | undefined, envKey: string): string {
    const key = configured || process.env[envKey] || '';
    if (!key) {
        throw new Error(i18nInstance.t('agent.tools.image.noKey', {env: envKey}));
    }
    return key;
}

/**
 * The link the service answers with expires within a day, so the bytes are kept right away.
 * They land in the store every other image goes through, which is what lets a chat, a browser
 * and an im client all reach the same picture through one reference.
 */
async function store(imageUrl: string, loopId: string): Promise<string> {
    const response = await fetch(imageUrl, {signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)});
    if (!response.ok) {
        throw new Error(`The generated image could not be downloaded (${response.status}): ${imageUrl}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return ImageStore.save(bytes, extensionOf(response.headers.get('content-type')), loopId);
}

/** A vendor draws pngs or jpegs depending on the model, so the header decides. */
function extensionOf(contentType: string | null): string {
    const extension = imageKeyExtension(contentType || '');
    return extension === 'bin' ? 'png' : extension;
}
