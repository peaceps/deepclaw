import { LoopAgent } from './loop'
import { ToolUseDef } from '../services/tool-use-service';
import { ToolUseResult } from '../../definitions/tool-definitions.js';
import { LoopState } from '../../definitions/definitions';
import { OpenAIResponseLLMModel, ThinkingMessage, ThinkingResponse } from '../../llm/openai-response-llm';
import { MessagesCompactor } from '../compactor/messages-compactor.js';
import { OpenAIResponseMessagesCompactor } from '../compactor/openai-response-compactor.js';

export class OpenAIResponseLoop extends LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIResponseLLMModel> {

    protected override createLLMModel(): OpenAIResponseLLMModel {
        return new OpenAIResponseLLMModel(
            this.promptService.provideSystemPrompt(this.isSubLoop()),
            this.toolUseService.getAvailableTools()
        );
    }

    protected override createMessagesCompactor(parentSessionId: string, sessionId: string): MessagesCompactor<ThinkingMessage, unknown> {
        return new OpenAIResponseMessagesCompactor(parentSessionId, sessionId);
    }

    protected override addStringMessage(message: string): void {
        this.history.push({role: 'user', content: message});
    }

    protected override convertResponseToMessages(response: ThinkingResponse): ThinkingMessage {
        const functionCall = response.output.find(out => out.type === 'function_call' as const);
        if (functionCall) {
            return {
                type: 'function_call',
                call_id: functionCall.call_id,
                arguments: functionCall.arguments,
                name: functionCall.name,
                id: functionCall.id
            }
        } else {
            const text = response.output.filter(out => out.type === 'message')
                .flatMap(message => message.content.filter(c => c.type === 'output_text').map(c => c.text)).join('\n');
            return {
                role: 'assistant',
                content: (!text ? response.output_text : text) || ''
            }
        }
    }

    protected override convertToolResultMessages(toolResults: ToolUseResult[]): ThinkingMessage[] {
        return toolResults.map(toolResult => ({
            role: 'tool',
            call_id: toolResult.id,
            output: toolResult.content,
            type: 'function_call_output',
            status: 'completed'
        }));
    }

    protected override quitLoop(result: ThinkingResponse): boolean {
        return result.status === 'completed' && !result.incomplete_details 
            && !result.output.some(item => item.type === 'function_call');
    }

    protected override extractToolUseFromResponse(result: ThinkingResponse): ToolUseDef[] {
        const toolCalls = result.output.filter((item) => item.type === 'function_call' as const);
        return toolCalls.map((item) => {
            return {
                name: item.name,
                input: item.arguments,
                id: item.call_id,
            }
        });
    }
    
    protected override extractFinalText(state: LoopState<ThinkingMessage>): string {
        if (state.messages.length === 0) {
            return '';
        }
        const message = state.messages[state.messages.length - 1]!;
        switch (message.type) {
            case 'function_call':
                return `${message.name}(${message.arguments})`;
            case 'function_call_output':
                return this.extractTextFromMessage(message.output);
            default:
                return this.extractTextFromMessage(message.content);
        }
    }

    private extractTextFromMessage(content: string | {type: string; text?: string}[]): string {
        return typeof content === 'string' ? content : content.map(
            (c) => c.type === 'input_text' ? (c.text || '') : ''
        ).join('\n');
    }

    protected override newSubLoop(parentSessionId: string, fork: boolean = false): LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIResponseLLMModel> {
        return new OpenAIResponseLoop(() => {}, fork ? this.history : [], parentSessionId);
    }
}
