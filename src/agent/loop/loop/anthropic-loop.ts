import { AnthropicLLM, ThinkingMessage, ThinkingResponse } from "../../llm/anthropic-llm";
import { LoopAgent } from "./loop";
import { ToolUseResult } from "../../definitions/tool-definitions.js";
import { LoopState } from "../../definitions/definitions";
import { ToolUseDef } from "../services/tool-use-service";
import { MessagesCompactor } from "../compactor/messages-compactor.js";
import { AnthropicMessagesCompactor } from "../compactor/anthropic-compactor.js";

export class AnthropicLoop extends LoopAgent<ThinkingMessage, ThinkingResponse, AnthropicLLM> {

    protected override createLLMModel(): AnthropicLLM {
        return new AnthropicLLM(
            this.promptService.provideSystemPrompt(this.isSubLoop()),
            this.toolUseService.getAvailableTools()
        );
    }

    protected override createMessagesCompactor(parentSessionId: string, sessionId: string): MessagesCompactor<ThinkingMessage, ThinkingResponse, unknown, AnthropicLLM> {
        return new AnthropicMessagesCompactor(this.llm, parentSessionId, sessionId);
    }

    protected override addStringMessage(message: string): void {
        this.history.push({role: 'user', content: message});
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

    protected override quitLoop(result: ThinkingResponse): boolean {
        return result.stop_reason != 'tool_use';
    }
    
    protected override extractFinalText(state: LoopState<ThinkingMessage>): string {
        const message = state.messages[state.messages.length - 1]!;
        if (state.messages.length === 0) {
            return '';
        }
        if (typeof message.content === 'string') {
            return message.content;
        }
        const texts: string[] = [];
        for (const block of message.content) {
            if (block.type === 'text' && block.text) {
                texts.push(block.text);
            } else if (block.type === 'tool_result' && block.content) {
                texts.push(typeof block.content === 'string' ? block.content : (
                    block.content.map(c => c.type === 'text' ? c.text : '').join('\n')
                ));
            } else if (block.type === 'tool_use' && block.id) {
                texts.push(`${block.name}(${JSON.stringify(block.input)})`);
            }
        }
        return texts.join("\n");
    }

    protected override newSubLoop(parentSessionId: string, fork: boolean = false): LoopAgent<ThinkingMessage, ThinkingResponse, AnthropicLLM> {
        return new AnthropicLoop(() => {}, fork ? this.history : [], parentSessionId);
    }

}
