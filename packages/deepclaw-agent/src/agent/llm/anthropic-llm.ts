import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import {
    Message,
    MessageParam,
    ToolResultBlockParam,
    TextBlockParam,
    ToolUseBlockParam,
    TextBlock,
    ToolUseBlock,
    ImageBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import { ToolUnion } from '@anthropic-ai/sdk/resources.js';
import { LLMModel } from './llmgw';
import { SystemPrompt } from '../definitions/definitions';
import { LLMTool } from '../definitions/tool-definitions';
import { isImageRef, LLMTransitionReason, TokenUsage, type ImageContent } from '@deepclaw/core';
import { IMAGE_UNAVAILABLE, resolveImage } from './image-resolver';

export type ThinkingContent = TextBlockParam | ToolUseBlockParam | ToolResultBlockParam | ImageBlockParam;

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type SupportedImageType = typeof SUPPORTED_IMAGE_TYPES[number];

const dataUrlRegex = /^data:([^;,]*)[^,]*,([\s\S]*)$/;

function supportedImageType(mediaType?: string): SupportedImageType | undefined {
    return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(mediaType ?? '')
        ? mediaType as SupportedImageType : undefined;
}

export type ThinkingMessage = Omit<MessageParam, 'content'> & {
    content: string | ThinkingContent[];
};

export type ThinkingResponse = Omit<Message, 'content'> & {
    content: (TextBlock | ToolUseBlock)[];
    transitionReason: LLMTransitionReason;
};

export class AnthropicLLM extends LLMModel<ThinkingMessage, ThinkingResponse, ToolUnion, Anthropic> {

    protected override convertTools(tools: LLMTool[]): ToolUnion[] {
        return tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.schema
        }));
    }

    protected override createLLMClient(baseURL: string, apiKey: string, timeout: number): Anthropic {
        return new Anthropic({
            baseURL,
            apiKey,
            timeout
        });
    }

    protected override async _invoke(
        system: SystemPrompt,
        messages: ThinkingMessage[],
        tools: ToolUnion[],
        streamer: (text: string) => void
    ): Promise<ThinkingResponse> {
        const stream = this.client.messages.stream({
            model: this.gw.model,
            system: this.systemBlocks(system),
            messages: this.markHistoryEnd(messages),
            tools,
            max_tokens: this.gw.maxTokens,
            temperature: this.gw.temperature,
        }).on('text', (text) => {
            streamer(text);
        });

        const response = await stream.finalMessage();
        return this.setTransitionReason(response as unknown as ThinkingResponse);
    }

    /**
     * A breakpoint of its own for each of the two cached pieces, so what the agent learns of itself
     * mid session rewrites only the shorter one. An empty piece is left out: a text block with
     * nothing in it is refused, and a breakpoint on it would cache the same prefix twice.
     */
    private systemBlocks(system: SystemPrompt): TextBlockParam[] {
        const cached: TextBlockParam[] = [system.cacheable, system.learned]
            .filter(text => !!text.trim())
            .map(text => ({type: 'text', text, cache_control: {type: 'ephemeral'}}));
        return system.dynamic.trim()
            ? [...cached, {type: 'text', text: system.dynamic}]
            : cached;
    }

    /**
     * The end of the history carries a breakpoint, which is what lets the next call read all of it
     * back instead of paying for every turn again: the cache of this call is the prefix of the next.
     * The mark goes on a copy of the last message, since the history itself is what the next call is
     * built from and a mark left in it would be sent again, spending a breakpoint on a turn that
     * has one behind it already.
     */
    private markHistoryEnd(messages: ThinkingMessage[]): ThinkingMessage[] {
        const last = messages[messages.length - 1];
        if (!last) {
            return messages;
        }
        // Plain text becomes the one block it always was on the wire, unless it says nothing at
        // all: an empty block is refused, and there is nothing to hold a mark in it anyway.
        const content: ThinkingContent[] = typeof last.content === 'string'
            ? (last.content ? [{type: 'text', text: last.content}] : [])
            : [...last.content];
        const end = content[content.length - 1];
        if (!end) {
            return messages;
        }
        content[content.length - 1] = {...end, cache_control: {type: 'ephemeral'}};
        return [...messages.slice(0, -1), {...last, content}];
    }

    protected override isInputExceedLimit(error: any): boolean {
        if (error?.status !== 400 || error?.type !== 'invalid_request_error') {
            return false;
        }
        // Anthropic words it as "prompt is too long" or "exceed context limit" depending on the endpoint.
        const message = String(error.message ?? '').toLowerCase();
        return message.includes('large') || message.includes('too long') || message.includes('context limit');
    }

    protected override newResponse(content: string, transitionReason: LLMTransitionReason = 'endLoop'): ThinkingResponse {
        return {
            transitionReason,
            id: randomUUID(),
            container: null,
            model: this.gw.model,
            stop_details: null,
            stop_reason: 'end_turn',
            stop_sequence: null,
            role: 'assistant',
            content: [{ type: 'text', text: content, citations: [] }],
            type: 'message',
            usage: {
                cache_creation: null,
                cache_creation_input_tokens: null,
                cache_read_input_tokens: null,
                inference_geo: null,
                server_tool_use: null,
                service_tier: null,
                input_tokens: 0,
                output_tokens: 0,
            }
        };
    }

    protected override setTransitionReason(result: ThinkingResponse): ThinkingResponse {
        const thinkingResponse = result;
        switch (result.stop_reason) {
            case 'tool_use':
                thinkingResponse.transitionReason = 'toolUse';
                break;
            case 'max_tokens':
                thinkingResponse.transitionReason = 'maxTokens';
                break;
            case 'refusal':
                thinkingResponse.transitionReason = 'refused';
                break;
            case 'end_turn':
                thinkingResponse.transitionReason = 'endLoop';
                break;
            default:
                thinkingResponse.transitionReason = 'endLoop';
        }
        return thinkingResponse;
    }

    protected override convertResponseToMessages(response: ThinkingResponse): ThinkingMessage[] {
        return [{role: 'assistant', content: response.content}];
    }

    protected override getTextFromResponse(response: ThinkingResponse): string {
        return this.getTextFromContent(response.content);
    }

    public override getTextFromInputMessage(message: ThinkingMessage): string {
        return typeof message.content === 'string' ? message.content : this.getTextFromContent(message.content);
    }

    private getTextFromContent(content: ThinkingContent[]): string {
        return content.filter(block => block.type === 'text').map(block => block.text || '').join('\n');
    }

    public override newImageInputMessage(content: string, images: ImageContent[]): ThinkingMessage {
        const contentParts: ThinkingContent[] = [{type: 'text', text: content}];
        for (const image of images) {
            const source = this.imageSource(image);
            contentParts.push(source
                ? {type: 'image', source}
                : {type: 'text', text: `[image dropped, unsupported type ${image.mediaType || 'unknown'}]`});
        }
        return {role: 'user', content: contentParts};
    }

    protected override resolveImages(messages: ThinkingMessage[]): ThinkingMessage[] {
        return messages.some(message => this.hasRef(message))
            ? messages.map(message => this.resolveMessage(message)) : messages;
    }

    private hasRef(message: ThinkingMessage): boolean {
        return typeof message.content !== 'string' && message.content.some(block => !!this.refOf(block));
    }

    private resolveMessage(message: ThinkingMessage): ThinkingMessage {
        return this.hasRef(message)
            ? {...message, content: (message.content as ThinkingContent[]).map(block => this.resolveBlock(block))}
            : message;
    }

    private refOf(block: ThinkingContent): string | undefined {
        return block.type === 'image' && block.source.type === 'url' && isImageRef(block.source.url)
            ? block.source.url : undefined;
    }

    private resolveBlock(block: ThinkingContent): ThinkingContent {
        const ref = this.refOf(block);
        if (!ref) {
            return block;
        }
        const resolved = resolveImage(ref);
        if (resolved.type === 'bytes') {
            const mediaType = supportedImageType(resolved.mediaType);
            if (mediaType) {
                return {type: 'image', source: {type: 'base64', media_type: mediaType, data: resolved.base64}};
            }
            return {type: 'text', text: `[image dropped, unsupported type ${resolved.mediaType}]`};
        }
        return {type: 'text', text: IMAGE_UNAVAILABLE};
    }

    private imageSource(image: ImageContent): ImageBlockParam['source'] | undefined {
        const dataUrl = dataUrlRegex.exec(image.url);
        if (!dataUrl) {
            return {type: 'url', url: image.url};
        }
        // a data url is only usable as a base64 source, which anthropic accepts for four types only
        const mediaType = supportedImageType(image.mediaType || dataUrl[1]);
        return mediaType ? {type: 'base64', media_type: mediaType, data: dataUrl[2] || ''} : undefined;
    }

    public override getTokenUsage(response: ThinkingResponse): TokenUsage {
        return {
            outputTokens: response.usage.output_tokens,
            noCachedInputTokens: (response.usage.input_tokens || 0) +
                (response.usage.cache_creation_input_tokens || 0),
            cachedInputTokens: response.usage.cache_read_input_tokens || 0,
        };
    }

}
