import { AnthropicLLM, ThinkingMessage, ThinkingResponse } from "../../llm/anthropic-llm";
import { LoopAgent } from "./loop";
import { ToolUseResult, ToolUseDef } from "../../definitions/tool-definitions";
import { LLMConstructor } from '../../llm/llmgw';
import { AgentHandler } from '@deepclaw/core';
import { LLMProtocol, OneLoopContext } from "../../definitions/definitions";

export class AnthropicLoop extends LoopAgent<ThinkingMessage, ThinkingResponse, AnthropicLLM> {

    protected override getLLMProtocol(): LLMProtocol {
        return 'Anthropic'
    }

    protected override getLLMConstructor(): LLMConstructor<ThinkingMessage, ThinkingResponse, unknown, unknown> {
        return AnthropicLLM;
    }
    
    protected override addTokenUsage(context: OneLoopContext, response: ThinkingResponse): void {
        context.usage.noCachedInputTokens += response.usage.input_tokens;
        context.usage.outputTokens += response.usage.output_tokens;
        context.usage.cachedInputTokens += response.usage.cache_read_input_tokens || 0;
        context.usage.cacheCreationInputTokens += response.usage.cache_creation_input_tokens || 0;
    }

    protected override convertToolResultMessages(toolResults: ToolUseResult[]): ThinkingMessage[] {
        const content = toolResults.map(toolResult => ({
            type: 'tool_result' as const,
            tool_use_id: toolResult.id,
            content: toolResult.content,
        }));
        return [{role: 'user', content: content}];
    }

    protected override extractToolUseFromResponse(result: ThinkingResponse): ToolUseDef[] {
        const toolUses = result.content.filter(block => block.type === 'tool_use');
        return toolUses.map(toolUse => ({
            id: toolUse.id,
            name: toolUse.name,
            input: toolUse.input
        }));
    }

    protected override newSubLoop(
        agentId: string,
        projectId: string,
        subLoopAgentHandler: AgentHandler,
        history: ThinkingMessage[],
        parentSessionId: string,
    ): LoopAgent<ThinkingMessage, ThinkingResponse, AnthropicLLM> {
        return new AnthropicLoop(agentId, subLoopAgentHandler, projectId, history, parentSessionId);
    }

}
