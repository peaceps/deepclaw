import { OpenAIChatLLM, ThinkingMessage, ThinkingResponse } from '../../llm/openai-chat-llm';
import { LoopAgent } from './loop';
import { ToolUseDef } from '../services/tool-use-service';
import { ToolUseResult } from '../../definitions/tool-definitions';
import { LLMConstructor } from '../../llm/llmgw';
import { AgentHandler } from '@deepclaw/core';
import { LLMProtocol, OneLoopContext } from '../../definitions/definitions';

export class OpenAIChatLoop extends LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIChatLLM> {

    protected override getLLMProtocol(): LLMProtocol {
        return 'OpenAIChat'
    }

    protected override getLLMConstructor(): LLMConstructor<ThinkingMessage, ThinkingResponse, unknown, unknown> {
        return OpenAIChatLLM;
    }

    protected override addTokenUsage(context: OneLoopContext, response: ThinkingResponse): void {
        if (response.usage) {
            const cachedTokens = response.usage.prompt_tokens_details?.cached_tokens || 0;
            context.usage.cachedInputTokens += cachedTokens;
            context.usage.noCachedInputTokens += response.usage.prompt_tokens - cachedTokens;
            context.usage.outputTokens += response.usage.completion_tokens;
        }
    }

    protected override convertToolResultMessages(toolResults: ToolUseResult[]): ThinkingMessage[] {
        return toolResults.map(toolResult => ({
            role: 'tool',
            tool_call_id: toolResult.id,
            content: toolResult.content,
        }));
    }

    protected override extractToolUseFromResponse(result: ThinkingResponse): ToolUseDef[] {
        return result.delta.tool_calls?.map(block => ({
            id: block.id || '',
            name: block.function?.name || '',
            input: block.function?.arguments,
        })) || [];
    }

    protected override newSubLoop(
        agentId: string,
        projectId: string,
        subLoopAgentHandler: AgentHandler,
        history: ThinkingMessage[],
        parentSessionId: string,
    ): LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIChatLLM> {
        return new OpenAIChatLoop(agentId, subLoopAgentHandler, projectId, history, parentSessionId);
    }
}
