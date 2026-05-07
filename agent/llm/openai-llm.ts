import OpenAI from 'openai';
import { ChatCompletionTool, ChatCompletionChunk, ChatCompletionMessageParam,
    ChatCompletionContentPart } from 'openai/resources/chat/completions.js';
import { LLMModel } from './llmgw.js';
import { LLMTool } from '../definitions/tool-definitions.js';
import { LoopMessageParam } from '../definitions/definitions.js';
import { formatLLMText } from '../utils/utils.js';

export type ThinkingResponse = ChatCompletionChunk.Choice & {
    delta: ChatCompletionChunk.Choice.Delta & {
        reasoning_content: string;
    }
}

export class OpenAILLMModel extends LLMModel<ChatCompletionContentPart, ChatCompletionMessageParam, ThinkingResponse, ChatCompletionTool, OpenAI> {

    protected override convertTools(tools: LLMTool[]): ChatCompletionTool[] {
        return tools.map(tool => (
            { type: 'function', function: {name: tool.name, description: tool.description,} }
        ));
    }

    protected override createLLMClient(): OpenAI {
        return new OpenAI({timeout: this.gw.timeoutMs, defaultHeaders: this.gw.headers});
    }

    override async invoke(
        messages: LoopMessageParam<ChatCompletionContentPart>[],
        onStreamEvent: (text: string) => void
    ): Promise<ThinkingResponse> {
        if (messages.length === 1) {
            messages.unshift({role: 'system', content: this.system});
        }
        const stream = await this.client.chat.completions.create({
            model: this.gw.model,
            messages: this.convertMessages(messages),
            max_tokens: this.gw.maxTokens,
            temperature: this.gw.temperature,
            tools: this.tools,
            tool_choice: 'auto',
            stream: true,
        });

        let toolCallResult: ChatCompletionChunk.Choice.Delta.ToolCall | null = null;
        let reasoningConent = '';
        for await (const chunk of stream) {
            const response = chunk.choices[0] as ThinkingResponse;
            const content = response?.delta?.content || '';
            reasoningConent += response?.delta?.reasoning_content || '';
            if (content.trim().length > 0) {
                onStreamEvent(formatLLMText(content));
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
                toolCallResult.function!.arguments += toolCall.function?.arguments || '';
            }

            if (!!response?.finish_reason && (response?.finish_reason as string) !== 'null') {
                if (toolCallResult) {
                    response.delta.tool_calls = [toolCallResult];
                }
                if (reasoningConent.trim().length > 0) {
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

    protected override convertMessages(messages: LoopMessageParam<ChatCompletionContentPart>[]): ChatCompletionMessageParam[] {
        const handledMessages: ChatCompletionMessageParam[] = [];
        for (const msg of messages) {
            handledMessages.push(msg as ChatCompletionMessageParam);
        }
        return handledMessages;
    }

}