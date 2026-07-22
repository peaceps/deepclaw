import { OpenAIChatLLM, ThinkingMessage, ThinkingResponse } from '../../llm/openai-chat-llm';
import { LoopAgent } from './loop';
import { ToolUseResult, ToolUseDef } from "../../definitions/tool-definitions";
import { LLMConstructor } from '../../llm/llmgw';
import { AgentHandler, FlushAgentRole } from '@deepclaw/core';
import { LLMProtocol } from '../../definitions/definitions';

export class OpenAIChatLoop extends LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIChatLLM> {

    protected override getLLMProtocol(): LLMProtocol {
        return 'OpenAIChat'
    }

    protected override getLLMConstructor(): LLMConstructor<ThinkingMessage, ThinkingResponse, unknown, unknown> {
        return OpenAIChatLLM;
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
        role: FlushAgentRole,
        agentId: string,
        projectId: string,
        subLoopAgentHandler: AgentHandler,
        subLoopId: string,
    ): LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIChatLLM> {
        return new OpenAIChatLoop(role, agentId, projectId, subLoopAgentHandler, subLoopId);
    }
}
