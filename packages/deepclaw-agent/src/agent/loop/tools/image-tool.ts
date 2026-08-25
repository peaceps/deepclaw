import type { ImageModel } from '@deepclaw/config';
import {
    imageExtensionOf, imageKeyExtension, imageKeyMediaType, imageRefKey, newImageRef, parseDataUrl
} from '@deepclaw/core';
import { i18nInstance } from '@deepclaw/i18n';
import { FileUtils, ImageStore } from '@deepclaw/node-utils';
import { GPT_IMAGE_MODELS, GptImageGenerator } from '../../image/gpt-image-generator';
import { ImageGenerator } from '../../image/image-generator';
import { QWEN_MODELS, QwenImageGenerator } from '../../image/qwen-image-generator';
import { SEEDREAM_MODELS, SeedreamImageGenerator } from '../../image/seedream-image-generator';
import { IMAGE_FOOT_PRINT, OneLoopContext } from '../../definitions/definitions';
import { ToolDesc } from '../../definitions/tool-definitions';
import { fileGuard } from './file-tool';

const DOWNLOAD_TIMEOUT_MS = 60_000;

const SIZES = ['1328*1328', '1664*928', '928*1664', '1472*1104', '1104*1472'] as const;

// A vendor refuses a picture of more than ten megabytes, and qwen takes at most three of them.
const MAX_SOURCE_MB = 10;
const MAX_SOURCE_IMAGES = 3;

type GenerateImageInput = {
    prompt: string;
    negativePrompt?: string;
    size?: typeof SIZES[number];
    sourceImages?: string[];
};

export const generateImageTool: ToolDesc<GenerateImageInput> = {
    tool: {
        name: 'generate_image',
        description: `Generate an image with the image model of this agent, from a text description
and, when asked to change or reuse a picture of this conversation, from that picture as well.
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
                sourceImages: {
                    type: 'array',
                    items: {type: 'string'},
                    maxItems: MAX_SOURCE_IMAGES,
                    description: `The pictures to draw from, named by the dcimg:// references they
carry in this conversation. Pass them to edit, redraw or combine what is already there, and leave
them out to draw from the prompt alone.`,
                },
            },
            required: ['prompt'],
        },
    },
    agentMode: ['agent', 'chat'],
    parallelSafe: true,
    invoke: async function(input: GenerateImageInput, context: OneLoopContext): Promise<string> {
        const prompt = input.prompt?.trim();
        if (!prompt) {
            throw new Error('The prompt of an image cannot be empty.');
        }
        const choice = context.loopConfig.multimodal.imageModel;
        if (!choice) {
            throw new Error(i18nInstance.t('agent.tools.image.noModel'));
        }
        const generator = generatorOf(choice, context.loopConfig.multimodal.imageApiKey);
        const drawn = await generator.draw({
            prompt,
            negativePrompt: input.negativePrompt,
            size: input.size,
            images: sourcesOf(input.sourceImages),
        });
        const ref = newImageRef(await store(drawn, context.loopId));
        context.actions.addFootPrint({type: IMAGE_FOOT_PRINT, content: ref});
        return i18nInstance.t('agent.tools.image.saved', {url: ref});
    },
};

// Kept in step with what an image model will take from us, a picture being worth keeping mostly
// where it can also be handed on.
const MAX_KEPT_MB = MAX_SOURCE_MB;

type KeepImageInput = {
    filePath: string;
};

/**
 * A picture already written to disk, laid down where every other picture of this app lives so that
 * a chat, a browser and an im client all reach it through the one reference. A path reaches none of
 * them: the chat is read somewhere else than where the file was written, which is the usual case
 * and the whole of why a screenshot named in an answer shows the user nothing.
 */
export const keepImageTool: ToolDesc<KeepImageInput> = {
    tool: {
        name: 'keep_image',
        description: `Keep a picture that is already on disk, such as a screenshot a command took or
a chart a script drew, and answer with the reference it comes back as. Naming the file path instead
shows the user nothing, the chat being read where that file is not. This only puts the picture in
front of the user; nothing of it is sent to the model.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Where the picture is, as the command that wrote it named the file.',
                },
            },
            required: ['filePath'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: true,
    invoke: async function(input: KeepImageInput, context: OneLoopContext): Promise<string> {
        const filePath = input.filePath?.trim();
        const extension = filePath ? imageExtensionOf(filePath) : null;
        if (!extension) {
            throw new Error(i18nInstance.t('agent.tools.image.notAPicture', {path: filePath}));
        }
        // Asked of the file rather than of its bytes: a picture too big to keep is too big to read
        // into memory first. What is no file at all answers nothing and is left to the read below,
        // which names a missing one plainly and hands along whatever the disk says of a folder that
        // happens to be called a picture.
        const megabytes = (FileUtils.sizeOf(filePath) ?? 0) / 1024 / 1024;
        if (megabytes > MAX_KEPT_MB) {
            throw new Error(i18nInstance.t('agent.tools.image.tooLargeToKeep', {
                path: filePath, size: megabytes.toFixed(1), limit: MAX_KEPT_MB,
            }));
        }
        const bytes = FileUtils.readBuffer(filePath);
        const ref = newImageRef(ImageStore.save(bytes, extension, context.loopId));
        context.actions.addFootPrint({type: IMAGE_FOOT_PRINT, content: ref});
        return i18nInstance.t('agent.tools.image.kept', {url: ref});
    },
    guard: fileGuard,
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
    if (GPT_IMAGE_MODELS.includes(choice)) {
        return new GptImageGenerator(choice, keyOf(configuredKey, GptImageGenerator.envKey));
    }
    throw new Error(i18nInstance.t('agent.tools.image.unsupportedModel', {model: choice}));
}

/**
 * A vendor draws from bytes it can reach on its own: a link is handed over as it is, while the
 * picture behind a reference of this conversation only exists here and travels inline.
 */
function sourcesOf(refs?: string[]): string[] | undefined {
    return refs?.length ? refs.map(ref => sourceOf(ref)) : undefined;
}

function sourceOf(ref: string): string {
    const key = imageRefKey(ref);
    if (!key) {
        if (!/^https?:\/\//.test(ref)) {
            throw new Error(i18nInstance.t('agent.tools.image.unknownImage', {ref}));
        }
        return ref;
    }
    const bytes = ImageStore.read(key);
    if (!bytes) {
        throw new Error(i18nInstance.t('agent.tools.image.unknownImage', {ref}));
    }
    const megabytes = bytes.length / 1024 / 1024;
    if (megabytes > MAX_SOURCE_MB) {
        throw new Error(i18nInstance.t('agent.tools.image.imageTooLarge', {
            ref, size: megabytes.toFixed(1), limit: MAX_SOURCE_MB,
        }));
    }
    return `data:${imageKeyMediaType(key)};base64,${bytes.toString('base64')}`;
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
 * One vendor answers with a link that expires within a day, another hands the bytes over inline;
 * either way they are kept right away. They land in the store every other image goes through,
 * which is what lets a chat, a browser and an im client all reach the same picture through one
 * reference.
 */
async function store(drawn: string, loopId: string): Promise<string> {
    const inline = parseDataUrl(drawn);
    if (inline) {
        return ImageStore.save(
            Buffer.from(inline.base64, 'base64'), extensionOf(inline.mediaType), loopId
        );
    }
    const response = await fetch(drawn, {signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)});
    if (!response.ok) {
        throw new Error(`The generated image could not be downloaded (${response.status}): ${drawn}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return ImageStore.save(bytes, extensionOf(response.headers.get('content-type')), loopId);
}

/** A vendor draws pngs or jpegs depending on the model, so the header decides. */
function extensionOf(contentType: string | null): string {
    const extension = imageKeyExtension(contentType || '');
    return extension === 'bin' ? 'png' : extension;
}
