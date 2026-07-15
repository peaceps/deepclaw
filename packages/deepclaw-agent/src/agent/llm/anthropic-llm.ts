import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { 
    Message,
    MessageParam,
    ToolResultBlockParam,
    TextBlockParam,
    ToolUseBlockParam,
    TextBlock,
    ToolUseBlock
} from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import { ToolUnion } from '@anthropic-ai/sdk/resources.js';
import { LLMModel } from './llmgw';
import { LLMTool } from '../definitions/tool-definitions';
import { LLMTransitionReason, TokenUsage } from '@deepclaw/core';

export type ThinkingContent = TextBlockParam | ToolUseBlockParam | ToolResultBlockParam;

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
        system: string,
        messages: ThinkingMessage[],
        tools: ToolUnion[],
        streamer: (text: string) => void
    ): Promise<ThinkingResponse> {
        const stream = this.client.messages.stream({
            model: this.gw.model,
            system: [{type: 'text', text: system, cache_control: {type: 'ephemeral'}}],
            messages,
            tools,
            max_tokens: this.gw.maxTokens,
            temperature: this.gw.temperature,
        }).on('text', (text) => {
            streamer(text);
        });

        const response = await stream.finalMessage();
        return this.setTransitionReason(response as unknown as ThinkingResponse);
    }

    protected override isInputExceedLimit(error: any): boolean {
        return error.status === 400 && error.type === 'invalid_request_error' && error.message.toLowerCase().includes('large');
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

    public override getTokenUsage(response: ThinkingResponse): TokenUsage {
        return {
            outputTokens: response.usage.output_tokens,
            noCachedInputTokens: (response.usage.input_tokens || 0) +
                (response.usage.cache_creation_input_tokens || 0),
            cachedInputTokens: response.usage.cache_read_input_tokens || 0,
        };
    }

}
