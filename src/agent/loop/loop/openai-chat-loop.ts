import { OpenAIChatLLM, ThinkingMessage, ThinkingResponse } from '../../llm/openai-chat-llm.js';
import { LoopAgent } from './loop.js';
import { ToolUseDef } from '../services/tool-use-service.js';
import { FootPrint } from '../../definitions/definitions.js';
import { ToolUseResult } from '../../definitions/tool-definitions.js';
import { MessagesCompactor } from '../compactor/messages-compactor.js';
import { OpenAIChatMessagesCompactor } from '../compactor/openai-chat-compactor.js';
import { LLMConstructor } from '../../llm/llmgw.js';
import { noopStreamHandler } from '@core';

export class OpenAIChatLoop extends LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIChatLLM> {

    protected override getLLMConstructor(): LLMConstructor<ThinkingMessage, ThinkingResponse, unknown, unknown> {
        return OpenAIChatLLM;
    }

    protected override createMessagesCompactor(parentSessionId: string, sessionId: string, footPrints: FootPrint[]): MessagesCompactor<ThinkingMessage, ThinkingResponse, unknown, OpenAIChatLLM> {
        return new OpenAIChatMessagesCompactor(this.llm, parentSessionId, sessionId, footPrints);
    }

    protected override quitLoop(result: ThinkingResponse): boolean {
        return result.finish_reason === 'stop';
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

    protected override newSubLoop(parentSessionId: string, fork: boolean = false): LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIChatLLM> {
        return new OpenAIChatLoop(noopStreamHandler, fork ? this.history : [], parentSessionId);
    }
}
