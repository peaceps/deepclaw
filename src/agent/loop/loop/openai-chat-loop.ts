import { OpenAIChatLLMModel, ThinkingMessage, ThinkingResponse } from '../../llm/openai-chat-llm.js';
import { LoopAgent } from './loop.js';
import { ToolUseDef } from '../services/tool-use-service.js';
import { ToolUseResult } from '../../definitions/tool-definitions.js';
import { LoopState } from '../../definitions/definitions.js';
import { MessagesCompactor } from '../compactor/messages-compactor.js';
import { OpenAIChatMessagesCompactor } from '../compactor/openai-chat-compactor.js';

export class OpenAIChatLoop extends LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIChatLLMModel> {

    protected override createLLMModel(): OpenAIChatLLMModel {
        return new OpenAIChatLLMModel(
            this.promptService.provideSystemPrompt(this.isSubLoop()),
            this.toolUseService.getAvailableTools()
        );
    }

    protected override createMessagesCompactor(parentSessionId: string, sessionId: string): MessagesCompactor<ThinkingMessage, unknown> {
        return new OpenAIChatMessagesCompactor(parentSessionId, sessionId);
    }

    protected override addStringMessage(message: string): void {
        this.history.push({role: 'user', content: message});
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

    protected override convertToolResultMessages(toolResults: ToolUseResult[]): ThinkingMessage[] {
        return toolResults.map(toolResult => ({
            role: 'tool',
            tool_call_id: toolResult.id,
            content: toolResult.content,
        }));
    }

    protected override quitLoop(result: ThinkingResponse): boolean {
        return result.finish_reason === 'stop';
    }

    protected override extractToolUseFromResponse(result: ThinkingResponse): ToolUseDef[] {
        return result.delta.tool_calls?.map(block => ({
            id: block.id || '',
            name: block.function?.name || '',
            input: block.function?.arguments,
        })) || [];
    }
    
    protected override extractFinalText(state: LoopState<ThinkingMessage>): string {
        if (state.messages.length === 0) {
            return '';
        }
        const message = state.messages[state.messages.length - 1]!;
        if (typeof message.content === 'string') {
            return message.content;
        }
        const texts: string[] = [];
        for (const block of message.content || []) {
            if (block.type === 'text' && block.text) {
                texts.push(block.text);
            }
        }
        return texts.join('\n');
    }

    protected override newSubLoop(parentSessionId: string, fork: boolean = false): LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIChatLLMModel> {
        return new OpenAIChatLoop(() => {}, fork ? this.history : [], parentSessionId);
    }
}
