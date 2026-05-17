import { LoopAgent } from './loop'
import { ToolUseDef } from '../services/tool-use-service';
import { FootPrint } from '../../definitions/definitions.js';
import { ToolUseResult } from '../../definitions/tool-definitions.js';
import { OpenAIResponseLLM, ThinkingMessage, ThinkingResponse } from '../../llm/openai-response-llm';
import { MessagesCompactor } from '../compactor/messages-compactor.js';
import { OpenAIResponseMessagesCompactor } from '../compactor/openai-response-compactor.js';
import { LLMConstructor } from '../../llm/llmgw';
import { noopStreamHandler } from '@core';

export class OpenAIResponseLoop extends LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIResponseLLM> {

    protected override getLLMConstructor(): LLMConstructor<ThinkingMessage, ThinkingResponse, unknown, unknown> {
        return OpenAIResponseLLM;
    }

    protected override createMessagesCompactor(parentSessionId: string, sessionId: string, footPrints: FootPrint[]): MessagesCompactor<ThinkingMessage, ThinkingResponse, unknown, OpenAIResponseLLM> {
        return new OpenAIResponseMessagesCompactor(this.llm, parentSessionId, sessionId, footPrints);
    }

    protected override quitLoop(result: ThinkingResponse): boolean {
        return result.status === 'completed' && !result.incomplete_details 
            && !result.output.some(item => item.type === 'function_call');
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

    protected override newSubLoop(parentSessionId: string, fork: boolean = false): LoopAgent<ThinkingMessage, ThinkingResponse, OpenAIResponseLLM> {
        return new OpenAIResponseLoop(noopStreamHandler, fork ? this.history : [], parentSessionId);
    }
}
