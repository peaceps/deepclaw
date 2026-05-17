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
import { LLMModel } from './llmgw.js';
import { LLMTool } from '../definitions/tool-definitions.js';
import { AgentStreamHandler } from '@core';

export type ThinkingContent = TextBlockParam | ToolUseBlockParam | ToolResultBlockParam;

export type ThinkingMessage = Omit<MessageParam, 'content'> & {
    content: string | ThinkingContent[];
};

export type ThinkingResponse = Omit<Message, 'content'> & {
    content: (TextBlock | ToolUseBlock)[];
};

export class AnthropicLLM extends LLMModel<ThinkingMessage, ThinkingResponse, ToolUnion, Anthropic> {

    protected override convertTools(tools: LLMTool[]): ToolUnion[] {
        return tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.schema
        }));
    }

    protected override createLLMClient(): Anthropic {
        return new Anthropic({
            timeout: this.gw.timeoutMs
        });
    }

    protected override async _invoke(
        messages: ThinkingMessage[],
        streamHandler: AgentStreamHandler
    ): Promise<ThinkingResponse> {
        const stream = this.client.messages.stream({
            model: this.gw.model,
            system: this.system,
            messages,
            tools: this.tools,
            max_tokens: this.gw.maxTokens,
            temperature: this.gw.temperature
        }).on('text', (text) => {
            streamHandler.onText(text);
        });

        return await stream.finalMessage() as ThinkingResponse;
    }

    protected override newResponse(content: string): ThinkingResponse {
        return {
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

    protected override convertResponseToMessages(response: ThinkingResponse): ThinkingMessage {
        return {role: 'assistant', content: response.content};
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

}
