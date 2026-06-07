import { OpenAIChatLLM, ThinkingMessage, ThinkingResponse } from '../../llm/openai-chat-llm';
import { LoopAgent } from './loop';
import { ToolUseDef } from '../services/tool-use-service';
import { FootPrint } from '../../definitions/definitions';
import { ToolUseResult } from '../../definitions/tool-definitions';
import { MessagesCompactor } from '../compactor/messages-compactor';
import { OpenAIChatMessagesCompactor } from '../compactor/openai-chat-compactor';
import { LLMConstructor } from '../../llm/llmgw';
import { AgentHandler } from '@deepclaw/core';

export class OpenAIChatLoop extends LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIChatLLM> {

    protected override getLLMConstructor(): LLMConstructor<ThinkingMessage, ThinkingResponse, unknown, unknown> {
        return OpenAIChatLLM;
    }

    protected override createMessagesCompactor(parentSessionId: string, sessionId: string, footPrints: FootPrint[]): MessagesCompactor<ThinkingMessage, ThinkingResponse, unknown, OpenAIChatLLM> {
        return new OpenAIChatMessagesCompactor(this.llm, parentSessionId, sessionId, footPrints);
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
        name: string,
        subLoopAgentHandler: AgentHandler,
        history: ThinkingMessage[],
        parentSessionId: string,
    ): LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIChatLLM> {
        return new OpenAIChatLoop(name, subLoopAgentHandler, history, parentSessionId);
    }
}
