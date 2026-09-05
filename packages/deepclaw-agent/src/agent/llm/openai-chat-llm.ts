import OpenAI from 'openai';
import {
    ChatCompletionTool,
    ChatCompletionChunk,
    ChatCompletionSystemMessageParam,
    ChatCompletionUserMessageParam,
    ChatCompletionAssistantMessageParam,
    ChatCompletionToolMessageParam,
    ChatCompletionContentPart,
    ChatCompletionContentPartRefusal,
 } from 'openai/resources/chat/completions.js';
import {
    CompletionUsage,
 } from 'openai/resources/completions.js';
import { isContextOverflowMessage, wordsOfError, LLMModel } from './llmgw';
import { SystemPrompt } from '../definitions/definitions';
import { LLMTool } from '../definitions/tool-definitions';
import { isImageRef, LLMTransitionReason, TokenUsage, type ImageContent } from '@deepclaw/core';
import { dataUrlOf, IMAGE_UNAVAILABLE, resolveImage } from './image-resolver';

type ContentPart = ChatCompletionContentPart | ChatCompletionContentPartRefusal;

export type ThinkingMessage = (
    ChatCompletionSystemMessageParam |
    ChatCompletionUserMessageParam |
    ChatCompletionAssistantMessageParam |
    ChatCompletionToolMessageParam
) & {
    reasoning_content?: string;
}

export type ThinkingResponse = ChatCompletionChunk.Choice & {
    transitionReason: LLMTransitionReason;
    usage?: CompletionUsage,
    delta: ChatCompletionChunk.Choice.Delta & {
        reasoning_content: string;
    }
}

export class OpenAIChatLLM extends LLMModel<ThinkingMessage, ThinkingResponse, ChatCompletionTool, OpenAI> {

    protected override convertTools(tools: LLMTool[]): ChatCompletionTool[] {
        return tools.map(tool => (
            { type: 'function', function: {name: tool.name, description: tool.description, parameters: tool.schema} }
        ));
    }

    protected override createLLMClient(baseURL: string, apiKey: string, timeout: number): OpenAI {
        return new OpenAI({
            baseURL,
            apiKey,
            timeout,
            // Asked again in the gateway above and nowhere else, where the asking can be seen.
            maxRetries: 0,
        });
    }

    protected override async _invoke(
        system: SystemPrompt,
        messages: ThinkingMessage[],
        tools: ChatCompletionTool[],
        streamer: (text: string) => void,
        signal?: AbortSignal
    ): Promise<ThinkingResponse> {
        const systemContent = `${system.cacheable}\n${system.learned}`;
        const systemIdx = messages.findIndex(m => m.role === 'system');
        if (systemIdx >= 0) {
            (messages[systemIdx] as ChatCompletionSystemMessageParam).content = systemContent;
        } else {
            messages.unshift({role: 'system', content: systemContent});
        }
        const stream = await this.client.chat.completions.create({
            model: this.gw.model,
            messages: this.withDynamicLast(system, messages),
            max_tokens: this.gw.maxTokens,
            tools,
            tool_choice: 'auto',
            stream: true,
            stream_options: {include_usage: true}
        }, {signal});

        const toolCallResults = new Map<number, ChatCompletionChunk.Choice.Delta.ToolCall>();
        let content = '';
        let reasoningContent = '';
        let finalResponse: ThinkingResponse | undefined = undefined;
        let usage: CompletionUsage | undefined = undefined;
        for await (const chunk of stream) {
            const response = chunk.choices[0] as ThinkingResponse;
            if (response) {
                const chunkContent = response.delta?.content || '';
                reasoningContent += (response.delta?.reasoning_content || '');
                if (chunkContent) {
                    content += chunkContent;
                    streamer(chunkContent);
                }
                const toolCalls = response.delta?.tool_calls || [];
                for (const toolCall of toolCalls) {
                    const index = toolCall.index ?? 0;
                    const existing = toolCallResults.get(index) || {
                        type: toolCall.type || 'function',
                        index,
                        id: toolCall.id,
                        function: { name: '', arguments: '' }
                    };
                    if (toolCall.id) {
                        existing.id = toolCall.id;
                    }
                    if (toolCall.type) {
                        existing.type = toolCall.type;
                    }
                    if (toolCall.function?.name) {
                        existing.function!.name = toolCall.function.name;
                    }
                    if (toolCall.function?.arguments) {
                        existing.function!.arguments += toolCall.function.arguments;
                    }
                    toolCallResults.set(index, existing);
                }

                if (!!response.finish_reason && (response.finish_reason as string) !== 'null') {
                    if (!response.delta) {
                        // Some vendors send the finishing chunk without any delta.
                        response.delta = {reasoning_content: ''};
                    }
                    if (toolCallResults.size > 0) {
                        response.delta.tool_calls = [...toolCallResults.entries()]
                            .sort(([a], [b]) => a - b).map(([, toolCall]) => toolCall);
                    }
                    if (content) {
                        response.delta.content = content;
                    }
                    if (reasoningContent) {
                        response.delta.reasoning_content = reasoningContent;
                    }
                    finalResponse = response;
                }
            }
            if (chunk.usage) {
                usage = chunk.usage;
            }
        }

        if (finalResponse) {
            if (usage) {
                finalResponse.usage = usage;
            }
            return this.setTransitionReason(finalResponse);
        }
        // The SDK swallows an abort and closes the iterator without a word of it, leaving a stopped
        // stream to look exactly like a model that said nothing: read that way, the user who pressed
        // stop is shown an error instead, and the error is written into the history as the answer of
        // the turn. Thrown rather than answered, since a throw is what the loop reads as a stop.
        signal?.throwIfAborted();
        return this.newResponse('Error: No response from LLM.', 'error');
    }

    /**
     * The state of the moment goes behind the history instead of into the system message. This
     * cache is a plain prefix match with no breakpoint to place: whatever moves has to sit as late
     * as possible, because everything after the first changed byte is paid for again. In the system
     * message a task the agent updates itself costs the whole conversation its cache; behind the
     * history it costs only its own tokens.
     *
     * The history is copied rather than appended to, since the next call is built from it and a
     * state left behind would be sent again next turn, stale by then and in front of the new one.
     * Copied even with no state to add: what was sent stays what was sent, while the history it was
     * read from goes on growing with the answer to this very call.
     */
    private withDynamicLast(system: SystemPrompt, messages: ThinkingMessage[]): ThinkingMessage[] {
        return system.dynamic.trim()
            ? [...messages, {role: 'system', content: system.dynamic}]
            : [...messages];
    }

    protected override newResponse(content: string, transitionReason: LLMTransitionReason = 'endLoop'): ThinkingResponse {
        return {
            transitionReason,
            finish_reason: 'stop',
            index: 0,
            delta: {
                content: content,
                reasoning_content: '',
                tool_calls: []
            }
        };
    }

    protected override setTransitionReason(result: ThinkingResponse): ThinkingResponse {
        const thinkingResponse = result as ThinkingResponse;
        switch (result.finish_reason) {
            case 'stop':
                thinkingResponse.transitionReason = 'endLoop';
                break;
            case 'length':
                thinkingResponse.transitionReason = 'maxTokens';
                break;
            case 'tool_calls':
                thinkingResponse.transitionReason = 'toolUse';
                break;
            case 'content_filter':
                thinkingResponse.transitionReason = 'refused';
                break;
            default:
                thinkingResponse.transitionReason = 'endLoop';
                break;
        }
        return thinkingResponse;
    }

    protected override isInputExceedLimit(error: any): boolean {
        // The code first, since openai names this one exactly, and the words after it for the
        // gateways that answer in this shape without borrowing the name: DashScope calls an
        // overflow `invalid_parameter_error`, which is also what it calls a malformed request, so
        // there is nothing to key on there but what the message says.
        return error?.status === 400 && (
            error?.error?.code === 'context_length_exceeded'
            || isContextOverflowMessage(wordsOfError(error))
        );
    }

    protected override convertResponseToMessages(response: ThinkingResponse): ThinkingMessage[] {
        const delta = response.delta;
        return [{
            role: 'assistant' as const,
            content: delta.content || '',
            reasoning_content: delta.reasoning_content || undefined,
            tool_calls: delta.tool_calls?.length ? delta.tool_calls.map((toolCall) => ({
                id: toolCall.id || '',
                function: {
                    name: toolCall.function?.name || '',
                    arguments: toolCall.function?.arguments || '',
                },
                type: 'function' as const,
            })) : undefined,
        }];
    }

    protected override getTextFromResponse(response: ThinkingResponse): string {
        return response.delta.content || '';
    }

    public override getTextFromInputMessage(message: ThinkingMessage): string {
        return (
            typeof message.content === 'string' ? message.content :
                message.content?.filter((block) => block.type === 'text').filter(block => !!block.text)
                    .map(block => block.text).join('\n')
        ) || '';
    }

    protected override resolveImages(messages: ThinkingMessage[]): ThinkingMessage[] {
        return messages.some(message => this.hasRef(message))
            ? messages.map(message => this.resolveMessage(message)) : messages;
    }

    private hasRef(message: ThinkingMessage): boolean {
        return Array.isArray(message.content) && message.content.some(block => !!this.refOf(block));
    }

    private resolveMessage(message: ThinkingMessage): ThinkingMessage {
        if (!this.hasRef(message)) {
            return message;
        }
        const content = (message.content as ContentPart[]).map(block => this.resolveBlock(block));
        return {...message, content} as ThinkingMessage;
    }

    private refOf(block: ContentPart): string | undefined {
        return block.type === 'image_url' && isImageRef(block.image_url.url) ? block.image_url.url : undefined;
    }

    private resolveBlock(block: ContentPart): ContentPart {
        const ref = this.refOf(block);
        if (!ref) {
            return block;
        }
        const resolved = resolveImage(ref);
        return resolved.type === 'bytes'
            ? {type: 'image_url', image_url: {url: dataUrlOf(resolved)}}
            : {type: 'text', text: IMAGE_UNAVAILABLE};
    }

    public override newImageInputMessage(content: string, images: ImageContent[]): ThinkingMessage {
        const message: ChatCompletionUserMessageParam = {
            role: 'user',
            content: [
                {type: 'text', text: content},
                ...images.map(image => ({type: 'image_url' as const, image_url: {url: image.url}})),
            ],
        };
        return message;
    }

    public override getTokenUsage(response: ThinkingResponse): TokenUsage {
        const cachedTokens = response.usage?.prompt_tokens_details?.cached_tokens || 0;
        return {
            cachedInputTokens: cachedTokens,
            noCachedInputTokens: (response.usage?.prompt_tokens || 0) - cachedTokens,
            outputTokens: response.usage?.completion_tokens || 0,
        };
    }
}
