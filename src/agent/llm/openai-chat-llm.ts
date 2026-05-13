import OpenAI from 'openai';
import {
    ChatCompletionTool,
    ChatCompletionChunk,
    ChatCompletionSystemMessageParam,
    ChatCompletionUserMessageParam,
    ChatCompletionAssistantMessageParam,
    ChatCompletionToolMessageParam,
 } from 'openai/resources/chat/completions.js';
import { LLMModel } from './llmgw.js';
import { LLMTool } from '../definitions/tool-definitions.js';

export type ThinkingMessage = (
    ChatCompletionSystemMessageParam |
    ChatCompletionUserMessageParam |
    ChatCompletionAssistantMessageParam |
    ChatCompletionToolMessageParam
) & {
    reasoning_content?: string;
}

export type ThinkingResponse = ChatCompletionChunk.Choice & {
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

    protected override createLLMClient(): OpenAI {
        return new OpenAI({timeout: this.gw.timeoutMs, defaultHeaders: this.gw.headers});
    }

    protected override async _invoke(
        messages: ThinkingMessage[],
        onStreamEvent: (text: string) => void
    ): Promise<ThinkingResponse> {
        if (messages.length === 1) {
            messages.unshift({role: 'system', content: this.system});
        }
        const stream = await this.client.chat.completions.create({
            model: this.gw.model,
            messages,
            max_tokens: this.gw.maxTokens,
            temperature: this.gw.temperature,
            tools: this.tools,
            tool_choice: 'auto',
            stream: true,
        });

        let toolCallResult: ChatCompletionChunk.Choice.Delta.ToolCall | null = null;
        let content = '';
        let reasoningContent = '';
        for await (const chunk of stream) {
            const response = chunk.choices[0] as ThinkingResponse;
            const chunkContent = response?.delta?.content || '';
            reasoningContent += (response?.delta?.reasoning_content || '');
            if (chunkContent) {
                content += chunkContent;
                onStreamEvent(chunkContent);
            }
            const toolCall = response?.delta?.tool_calls?.[0];
            if (toolCall) {
                if (!toolCallResult) {
                    toolCallResult = {
                        type: 'function',
                        index: toolCall.index,
                        id: toolCall.id,
                        function: {
                            name: toolCall.function?.name || '',
                            arguments: ''
                        }
                    }
                }
                toolCallResult.function!.arguments += (toolCall.function?.arguments || '');
            }

            if (!!response?.finish_reason && (response?.finish_reason as string) !== 'null') {
                if (toolCallResult) {
                    response.delta.tool_calls = [toolCallResult];
                }
                if (content) {
                    response.delta.content = content;
                }
                if (reasoningContent) {
                    response.delta.reasoning_content = reasoningContent;
                }
                
                return response;
            }
        }

        return this.newResponse('Error: No response from LLM.');
    }

    protected override newResponse(content: string): ThinkingResponse {
        return {
            finish_reason: 'stop',
            index: 0,
            delta: {
                content: content,
                reasoning_content: '',
                tool_calls: []
            }
        };
    }

    protected override convertResponseToMessages(response: ThinkingResponse): ThinkingMessage {
        const delta = response.delta;
        return {
            role: 'assistant' as const,
            content: delta.content || '',
            reasoning_content: delta.reasoning_content || undefined,
            tool_calls: delta.tool_calls?.map((toolCall) => ({
                id: toolCall.id || '',
                function: {
                    name: toolCall.function?.name || '',
                    arguments: toolCall.function?.arguments || '',
                },
                type: 'function' as const,
            })) || undefined,
        };
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
}
