import { LoopAgent } from './loop'
import { ToolUseDef } from '../services/tool-use-service';
import { FootPrint } from '../../definitions/definitions';
import { ToolUseResult } from '../../definitions/tool-definitions';
import { OpenAIResponseLLM, ThinkingMessage, ThinkingResponse } from '../../llm/openai-response-llm';
import { MessagesCompactor } from '../compactor/messages-compactor';
import { OpenAIResponseMessagesCompactor } from '../compactor/openai-response-compactor';
import { LLMConstructor } from '../../llm/llmgw';
import { AgentHandler, AgentIdentity } from '@deepclaw/core';

export class OpenAIResponseLoop extends LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIResponseLLM> {

    protected override getLLMConstructor(): LLMConstructor<ThinkingMessage, ThinkingResponse, unknown, unknown> {
        return OpenAIResponseLLM;
    }

    protected override createMessagesCompactor(name: string, parentSessionId: string, sessionId: string, footPrints: FootPrint[]): MessagesCompactor<ThinkingMessage, ThinkingResponse, unknown, OpenAIResponseLLM> {
        return new OpenAIResponseMessagesCompactor(name, parentSessionId, sessionId, footPrints);
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
        agentIdentity: AgentIdentity,
        subLoopAgentHandler: AgentHandler,
        history: ThinkingMessage[],
        parentSessionId: string,
    ): LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIResponseLLM> {
        return new OpenAIResponseLoop(agentIdentity, subLoopAgentHandler, history, parentSessionId);
    }
}
