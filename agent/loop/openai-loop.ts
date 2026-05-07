import { ChatCompletionContentPart, ChatCompletionChunk } from 'openai/resources/chat/completions.js';
import { OpenAILLMModel } from '../llm/openai-llm';
import { LoopAgent, SubLoopAgent } from './loop'
import { ToolUseDef } from './services/tool-use-service';
import { ToolUseResult } from '../definitions/tool-definitions.js';
import { LoopMessageParam } from '../definitions/definitions';
import { ThinkingResponse } from '../llm/openai-llm';

export class OpenAILoop extends LoopAgent<ChatCompletionContentPart, ChatCompletionChunk.Choice, OpenAILLMModel> {

    protected override createLLMModel(): OpenAILLMModel {
        return new OpenAILLMModel(
            this.promptService.provideSystemPrompt(this instanceof SubLoopAgent),
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

    protected override quitLoop(result: ChatCompletionChunk.Choice): boolean {
        return result.finish_reason === 'stop';
    }

    protected override extractToolCalls(result: ChatCompletionChunk.Choice): ToolUseDef[] {
        return result.delta.tool_calls?.map(block => ({
            id: block.id || '',
            name: block.function?.name || '',
            input: JSON.parse(block.function?.arguments || '{}'),
        })) || [];
    }
}