import OpenAI from 'openai';
import { ChatCompletionTool, ChatCompletionChunk, ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { LLMModel } from './llmgw.js';
import { LLMTool } from '../definitions/tool-definitions.js';
import { formatLLMText } from '../utils/utils.js';

export type ThinkingMessage = ChatCompletionMessageParam & {
    reasoning_content?: string;
}

export type ThinkingResponse = ChatCompletionChunk.Choice & {
    delta: ChatCompletionChunk.Choice.Delta & {
        reasoning_content: string;
    }
}

export class OpenAIChatLLMModel extends LLMModel<ThinkingMessage, ThinkingResponse, ChatCompletionTool, OpenAI> {

    protected override convertTools(tools: LLMTool[]): ChatCompletionTool[] {
        return tools.map(tool => (
            { type: 'function', function: {name: tool.name, description: tool.description, parameters: tool.schema} }
        ));
    }

    protected override createLLMClient(): OpenAI {
        return new OpenAI({timeout: this.gw.timeoutMs, defaultHeaders: this.gw.headers});
    }

    override async invoke(
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
        let reasoningConent = '';
        for await (const chunk of stream) {
            const response = chunk.choices[0] as ThinkingResponse;
            const chunkContent = formatLLMText(response?.delta?.content || '');
            reasoningConent += formatLLMText(response?.delta?.reasoning_content || '');
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
                toolCallResult.function!.arguments += formatLLMText(toolCall.function?.arguments || '');
            }

            if (!!response?.finish_reason && (response?.finish_reason as string) !== 'null') {
                if (toolCallResult) {
                    response.delta.tool_calls = [toolCallResult];
                }
                if (content) {
                    response.delta.content = content;
                }
                if (reasoningConent) {
                    response.delta.reasoning_content = reasoningConent;
                }
                
                return response;
            }
        }

        return {
            finish_reason: 'stop',
            index: 0,
            delta: {
                content: 'Error: No response from LLM.',
                reasoning_content: '',
                tool_calls: []
            }
        };
    }

}