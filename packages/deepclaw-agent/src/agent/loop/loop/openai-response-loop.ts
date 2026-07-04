import { LoopAgent } from './loop';
import { ToolUseResult, ToolUseDef } from "../../definitions/tool-definitions";
import { OpenAIResponseLLM, ThinkingMessage, ThinkingResponse } from '../../llm/openai-response-llm';
import { LLMConstructor } from '../../llm/llmgw';
import { AgentHandler } from '@deepclaw/core';
import { LLMProtocol, OneLoopContext } from '../../definitions/definitions';

export class OpenAIResponseLoop extends LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIResponseLLM> {

    protected override getLLMProtocol(): LLMProtocol {
        return 'OpenAIResponse'
    }

    protected override getLLMConstructor(): LLMConstructor<ThinkingMessage, ThinkingResponse, unknown, unknown> {
        return OpenAIResponseLLM;
    }
            
    protected override addTokenUsage(context: OneLoopContext, response: ThinkingResponse): void {
        if (response.usage) {
            const cachedTokens = response.usage.input_tokens_details?.cached_tokens || 0;
            context.usage.cachedInputTokens += cachedTokens;
            context.usage.noCachedInputTokens += response.usage.input_tokens - cachedTokens;
            context.usage.outputTokens += response.usage.output_tokens;
        }
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

    protected override convertToolResultMessages(toolResults: ToolUseResult[]): ThinkingMessage[] {
        return toolResults.map(toolResult => ({
            role: 'tool',
            call_id: toolResult.id,
            output: toolResult.content,
            type: 'function_call_output',
            status: 'completed'
        }));
    }

    protected override newSubLoop(
        agentId: string,
        projectId: string,
        subLoopAgentHandler: AgentHandler,
        history: ThinkingMessage[],
        parentSessionId: string,
    ): LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIResponseLLM> {
        return new OpenAIResponseLoop(agentId, subLoopAgentHandler, projectId, history, parentSessionId);
    }
}
