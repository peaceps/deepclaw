import { OpenAI } from "openai";
import { randomUUID } from "node:crypto";
import { i18nInstance } from '@deepclaw/i18n';
import { isContextOverflowMessage, wordsOfError, LLMModel } from './llmgw';
import { SystemPrompt } from '../definitions/definitions';
import { LLMTool } from '../definitions/tool-definitions';
import {
    ResponseInputItem,
    Tool,
    Response,
    EasyInputMessage,
    ResponseFunctionToolCall,
    ResponseOutputMessage,
    ResponseInputContent,
} from "openai/resources/responses/responses.js";
import { isImageRef, LLMTransitionReason, TokenUsage, type ImageContent } from "@deepclaw/core";
import { dataUrlOf, IMAGE_UNAVAILABLE, resolveImage } from './image-resolver';

export type ThinkingMessage = EasyInputMessage | ResponseFunctionToolCall | ResponseInputItem.FunctionCallOutput;

type ThinkingResponseOutput = ResponseOutputMessage | ResponseFunctionToolCall;

export type ThinkingResponse = Omit<Response, 'output'> & {
    output: ThinkingResponseOutput[];
    transitionReason: LLMTransitionReason;
};

export class OpenAIResponseLLM extends LLMModel<ThinkingMessage, ThinkingResponse, Tool, OpenAI> {

    protected override convertTools(tools: LLMTool[]): Tool[] {
        return tools!.map(tool => ({
            type: 'function',
            name: tool.name,
            strict: true,
            parameters: tool.schema,
            description: tool.description
        }));
    }

    protected override createLLMClient(baseURL: string, apiKey: string, timeout: number): OpenAI {
        return new OpenAI({
            baseURL,
            apiKey,
            timeout,
        });
    }
    
    protected override async _invoke(
        system: SystemPrompt,
        messages: ThinkingMessage[],
        tools: Tool[],
        streamer: (text: string) => void,
        signal?: AbortSignal
    ): Promise<ThinkingResponse> {

        const stream = await this.client.responses.create({
            model: this.gw.model,
            instructions: `${system.cacheable}\n${system.learned}`,
            input: this.withDynamicLast(system, messages),
            stream: true,
            tools,
            max_output_tokens: this.gw.maxTokens,
            temperature: this.gw.temperature,
        }, {signal});

        for await (const event of stream) {
            switch (event.type) {
                case 'response.output_text.delta':
                    streamer(event.delta);
                    break;
                case 'response.completed':
                    return this.setTransitionReason(event.response);
                case 'response.failed':
                    return this.flushAndRespondError(streamer, i18nInstance.t('agent.llm.openai.response.output.failed', {message: event.response.error?.message || ''}));
                case 'error':
                    return this.flushAndRespondError(streamer, i18nInstance.t(
                        'agent.llm.openai.response.output.error',
                        {code: event.code, param: event.param, message: event.message}
                    ));
            }
        }

        // An abort leaves the stream ended and says nothing about itself, so without this a stopped
        // run reads as a model that sent no output at all — and this error is streamed to the user
        // as it is answered, so they would watch it arrive under the stop they just pressed.
        signal?.throwIfAborted();
        return this.flushAndRespondError(streamer,
            i18nInstance.t('agent.llm.openai.response.output.empty'));
    }

    /**
     * The state of the moment goes behind the history instead of into the instructions. This cache
     * is a plain prefix match with no breakpoint to place: whatever moves has to sit as late as
     * possible, because everything after the first changed byte is paid for again. In the
     * instructions a task the agent updates itself costs the whole conversation its cache; behind
     * the history it costs only its own tokens.
     *
     * The history is copied rather than appended to, since the next call is built from it and a
     * state left behind would be sent again next turn, stale by then and in front of the new one.
     * Copied even with no state to add: what was sent stays what was sent, while the history it was
     * read from goes on growing with the answer to this very call.
     */
    private withDynamicLast(system: SystemPrompt, messages: ThinkingMessage[]): ThinkingMessage[] {
        return system.dynamic.trim()
            ? [...messages, {role: 'developer', content: system.dynamic}]
            : [...messages];
    }

    protected override setTransitionReason(response: Response): ThinkingResponse {
        const thinkingResponse = response as ThinkingResponse;
        if (thinkingResponse.status === 'completed') {
            thinkingResponse.transitionReason = thinkingResponse.output.some(item => item.type === 'function_call') ?
                'toolUse' : 'endLoop';
        } else if (thinkingResponse.status === 'incomplete') {
            switch (thinkingResponse.incomplete_details?.reason) {
                case 'max_output_tokens':
                    thinkingResponse.transitionReason = 'maxTokens';
                    break;
                case 'content_filter':
                    thinkingResponse.transitionReason = 'refused';
            }
        }
        if (!thinkingResponse.transitionReason) {
            throw new Error('Invalid response status: ' + thinkingResponse.status);
        }
        return thinkingResponse;
    }

    private flushAndRespondError(streamer: (text: string) => void, message: string): ThinkingResponse {
        streamer(message);
        return this.newResponse(message, 'error');
    }

    protected override newResponse(message: string, transitionReason: LLMTransitionReason = 'endLoop'): ThinkingResponse {
        return {
            transitionReason,
            id: randomUUID(),
            object: 'response',
            created_at: Date.now(),
            output: [{
                id: randomUUID(),
                status: 'completed' as const,
                type: 'message' as const,
                role: 'assistant' as const,
                content: [{type: 'output_text' as const, text: message, annotations: []}]
            }],
            output_text: '',
            error: null,
            incomplete_details: null,
            instructions: '',
            metadata: null,
            model: this.gw.model,
            tools: [],
            temperature: this.gw.temperature,
            parallel_tool_calls: false,
            tool_choice: 'none',
            top_p: 1,
        }
    }

    protected override isInputExceedLimit(error: any): boolean {
        // Same reading as the chat side, and for the same gateways.
        return error?.status === 400 && (
            error?.error?.code === 'context_length_exceeded'
            || isContextOverflowMessage(wordsOfError(error))
        );
    }

    protected override convertResponseToMessages(response: ThinkingResponse): ThinkingMessage[] {
        const functionCalls = response.output.filter(out => out.type === 'function_call' as const);
        if (functionCalls.length > 0) {
            return functionCalls.map((functionCall) => ({
                type: 'function_call',
                call_id: functionCall.call_id,
                arguments: functionCall.arguments,
                name: functionCall.name,
                id: functionCall.id
            }));
        }
        const text = response.output.filter(out => out.type === 'message')
            .flatMap(message => message.content.filter(c => c.type === 'output_text').map(c => c.text)).join('\n');
        return [{
            role: 'assistant',
            content: (!text ? response.output_text : text) || ''
        }];
    }
    
    protected override getTextFromResponse(response: ThinkingResponse): string {
        return response.output.filter(out => out.type === 'message')
            .map(message => this.extractTextFromContent(message.content, 'output_text')).join('\n');
    }

    public override getTextFromInputMessage(message: ThinkingMessage): string {
        return message.type === 'function_call' || message.type === 'function_call_output' ? ''
            : this.extractTextFromContent(message.content, 'input_text');
    }

    protected override resolveImages(messages: ThinkingMessage[]): ThinkingMessage[] {
        return messages.some(message => this.hasRef(message))
            ? messages.map(message => this.resolveMessage(message)) : messages;
    }

    private hasRef(message: ThinkingMessage): boolean {
        const content = (message as EasyInputMessage).content;
        return Array.isArray(content) && content.some(block => !!this.refOf(block));
    }

    private resolveMessage(message: ThinkingMessage): ThinkingMessage {
        if (!this.hasRef(message)) {
            return message;
        }
        const input = message as EasyInputMessage;
        return {...input, content: (input.content as ResponseInputContent[]).map(b => this.resolveBlock(b))};
    }

    private refOf(block: ResponseInputContent): string | undefined {
        return block.type === 'input_image' && block.image_url && isImageRef(block.image_url)
            ? block.image_url : undefined;
    }

    private resolveBlock(block: ResponseInputContent): ResponseInputContent {
        const ref = this.refOf(block);
        if (!ref) {
            return block;
        }
        const resolved = resolveImage(ref);
        return resolved.type === 'bytes'
            ? {type: 'input_image', image_url: dataUrlOf(resolved), detail: 'auto'}
            : {type: 'input_text', text: IMAGE_UNAVAILABLE};
    }

    public override newImageInputMessage(content: string, images: ImageContent[]): ThinkingMessage {
        const message: EasyInputMessage = {
            role: 'user',
            content: [
                {type: 'input_text', text: content},
                ...images.map(image => ({
                    type: 'input_image' as const, image_url: image.url, detail: 'auto' as const
                })),
            ],
        };
        return message;
    }

    private extractTextFromContent(content: string | {type: string; text?: string}[], attr: string): string {
        return typeof content === 'string' ? content :
            content.filter(block => block.type === attr).filter(block => !!block.text).map(block => block.text).join('\n');
    }

    public override getTokenUsage(response: ThinkingResponse): TokenUsage {
        const cachedTokens = response.usage?.input_tokens_details?.cached_tokens || 0;
        return {
            cachedInputTokens: cachedTokens,
            noCachedInputTokens: (response.usage?.input_tokens || 0) - cachedTokens,
            outputTokens: response.usage?.output_tokens || 0,
        };
    }
}
