import { ChatCompletionContentPart } from 'openai/resources/chat/completions.js';
import { OpenAIChatLLMModel } from '../llm/openai-chat-llm';
import { LoopAgent } from './loop'
import { ToolUseDef } from './services/tool-use-service';
import { ToolUseResult } from '../definitions/tool-definitions.js';
import { LoopMessageParam, LoopState } from '../definitions/definitions';
import { ThinkingResponse } from '../llm/openai-chat-llm';

export class OpenAIChatLoop extends LoopAgent<ChatCompletionContentPart, ThinkingResponse, OpenAIChatLLMModel> {

    protected override createLLMModel(): OpenAIChatLLMModel {
        return new OpenAIChatLLMModel(
            this.promptService.provideSystemPrompt(this.isSubLoop),
            this.toolUseService.getAvailableTools()
        );
    }

    protected override convertResponseToMessages(response: ThinkingResponse): LoopMessageParam<ChatCompletionContentPart> {
        const delta = response.delta;
        return {
            role: 'assistant' as const,
            content: delta.content || '',
            reasoning_content: delta.reasoning_content || undefined,
            tool_calls: delta.tool_calls || undefined,
        };
    }

    protected override convertToolResultMessages(toolResults: ToolUseResult[]): LoopMessageParam<ChatCompletionContentPart>[] {
        return toolResults.map(toolResult => ({
            role: 'tool',
            tool_call_id: toolResult.id,
            content: toolResult.content,
        }));
    }

    protected override quitLoop(result: ThinkingResponse): boolean {
        return result.finish_reason === 'stop';
    }

    protected override extractToolCalls(result: ThinkingResponse): ToolUseDef[] {
        return result.delta.tool_calls?.map(block => ({
            id: block.id || '',
            name: block.function?.name || '',
            input: JSON.parse(block.function?.arguments || '{}'),
        })) || [];
    }
    
    protected override extractFinalText(state: LoopState<ChatCompletionContentPart>): string {
        const message = state.messages[state.messages.length - 1]!;
        return message.content as string;
    }

    override createSubLoop(fork: boolean = false): LoopAgent<ChatCompletionContentPart, ThinkingResponse, OpenAIChatLLMModel> {
        return new OpenAIChatLoop(() => {}, fork ? this.history : [], true);
    }
}