import { OpenAIChatLLM, ThinkingMessage, ThinkingResponse } from '../../llm/openai-chat-llm.js';
import { LoopAgent } from './loop.js';
import { ToolUseDef } from '../services/tool-use-service.js';
import { ToolUseResult } from '../../definitions/tool-definitions.js';
import { LoopState } from '../../definitions/definitions.js';
import { MessagesCompactor } from '../compactor/messages-compactor.js';
import { OpenAIChatMessagesCompactor } from '../compactor/openai-chat-compactor.js';

export class OpenAIChatLoop extends LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIChatLLM> {

    protected override createLLMModel(): OpenAIChatLLM {
        return new OpenAIChatLLM(
            this.promptService.provideSystemPrompt(this.isSubLoop()),
            this.toolUseService.getAvailableTools()
        );
    }

    protected override createMessagesCompactor(parentSessionId: string, sessionId: string): MessagesCompactor<ThinkingMessage, ThinkingResponse, unknown, OpenAIChatLLM> {
        return new OpenAIChatMessagesCompactor(this.llm, parentSessionId, sessionId);
    }

    protected override addStringMessage(message: string): void {
        this.history.push({role: 'user', content: message});
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

    protected override newSubLoop(parentSessionId: string, fork: boolean = false): LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIChatLLM> {
        return new OpenAIChatLoop(() => {}, fork ? this.history : [], parentSessionId);
    }
}
