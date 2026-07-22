import { LoopAgent } from './loop';
import { ToolUseResult, ToolUseDef } from "../../definitions/tool-definitions";
import { OpenAIResponseLLM, ThinkingMessage, ThinkingResponse } from '../../llm/openai-response-llm';
import { LLMConstructor } from '../../llm/llmgw';
import { AgentHandler, FlushAgentRole } from '@deepclaw/core';
import { LLMProtocol } from '../../definitions/definitions';

export class OpenAIResponseLoop extends LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIResponseLLM> {

    protected override getLLMProtocol(): LLMProtocol {
        return 'OpenAIResponse'
    }

    protected override getLLMConstructor(): LLMConstructor<ThinkingMessage, ThinkingResponse, unknown, unknown> {
        return OpenAIResponseLLM;
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
        role: FlushAgentRole,
        agentId: string,
        projectId: string,
        subLoopAgentHandler: AgentHandler,
        subLoopId: string,
    ): LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIResponseLLM> {
        return new OpenAIResponseLoop(role, agentId, projectId, subLoopAgentHandler, subLoopId);
    }
}
