import { AnthropicLLM, ThinkingMessage, ThinkingResponse } from "../../llm/anthropic-llm";
import { LoopAgent } from "./loop";
import { FootPrint } from "../../definitions/definitions";
import { ToolUseResult } from "../../definitions/tool-definitions.js";
import { ToolUseDef } from "../services/tool-use-service";
import { MessagesCompactor } from "../compactor/messages-compactor.js";
import { AnthropicMessagesCompactor } from "../compactor/anthropic-compactor.js";
import { LLMConstructor } from '../../llm/llmgw';

export class AnthropicLoop extends LoopAgent<ThinkingMessage, ThinkingResponse, AnthropicLLM> {

    protected override getLLMConstructor(): LLMConstructor<ThinkingMessage, ThinkingResponse, unknown, unknown> {
        return AnthropicLLM;
    }

    protected override createMessagesCompactor(parentSessionId: string, sessionId: string, footPrints: FootPrint[]): MessagesCompactor<ThinkingMessage, ThinkingResponse, unknown, AnthropicLLM> {
        return new AnthropicMessagesCompactor(this.llm, parentSessionId, sessionId, footPrints);
    }

    protected override quitLoop(result: ThinkingResponse): boolean {
        return result.stop_reason != 'tool_use';
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

    protected override newSubLoop(parentSessionId: string, fork: boolean = false): LoopAgent<ThinkingMessage, ThinkingResponse, AnthropicLLM> {
        return new AnthropicLoop(() => {}, async () => '', fork ? this.history : [], parentSessionId);
    }

}
