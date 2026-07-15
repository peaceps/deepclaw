import { AnthropicLLM, ThinkingMessage, ThinkingResponse } from "../../llm/anthropic-llm";
import { LoopAgent } from "./loop";
import { ToolUseResult, ToolUseDef } from "../../definitions/tool-definitions";
import { LLMConstructor } from '../../llm/llmgw';
import { AgentHandler } from '@deepclaw/core';
import { LLMProtocol } from "../../definitions/definitions";

export class AnthropicLoop extends LoopAgent<ThinkingMessage, ThinkingResponse, AnthropicLLM> {

    protected override getLLMProtocol(): LLMProtocol {
        return 'Anthropic'
    }

    protected override getLLMConstructor(): LLMConstructor<ThinkingMessage, ThinkingResponse, unknown, unknown> {
        return AnthropicLLM;
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
        subLoopId: string,
    ): LoopAgent<ThinkingMessage, ThinkingResponse, AnthropicLLM> {
        return new AnthropicLoop(agentId, subLoopAgentHandler, projectId, subLoopId);
    }

}
