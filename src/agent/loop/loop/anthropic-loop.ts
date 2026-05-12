import { AnthropicLLMModel, ThinkingMessage, ThinkingResponse } from "../../llm/anthropic-llm";
import { LoopAgent } from "./loop";
import { ToolUseResult } from "../../definitions/tool-definitions.js";
import { LoopState } from "../../definitions/definitions";
import { ToolUseDef } from "../services/tool-use-service";

export class AnthropicLoop extends LoopAgent<ThinkingMessage, ThinkingResponse, AnthropicLLMModel> {

    protected override createLLMModel(): AnthropicLLMModel {
        return new AnthropicLLMModel(
            this.promptService.provideSystemPrompt(this.isSubLoop),
            this.toolUseService.getAvailableTools()
        );
    }

    protected override addStringMessage(message: string): void {
        this.history.push({role: 'user', content: message});
    }

    protected override convertResponseToMessages(response: ThinkingResponse): ThinkingMessage {
        return {role: 'assistant', content: response.content};
    }

    protected override convertToolResultMessages(toolResults: ToolUseResult[]): ThinkingMessage[] {
        const content = toolResults.map(toolResult => ({
            type: 'tool_result' as const,
            tool_use_id: toolResult.id,
            content: toolResult.content,
        }));
        return [{role: 'user', content: content}];
    }

    protected override extractToolCalls(result: ThinkingResponse): ToolUseDef[] {
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
        const texts: string[] = [];
        const message = state.messages[state.messages.length - 1]!;
        if (typeof message.content === 'string') {
            return message.content;
        }
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

    override createSubLoop(fork: boolean = false): LoopAgent<ThinkingMessage, ThinkingResponse, AnthropicLLMModel> {
        return new AnthropicLoop(() => {}, fork ? this.history : [], true);
    }

}