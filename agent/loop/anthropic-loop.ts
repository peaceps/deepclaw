import { ParsedMessage } from "@anthropic-ai/sdk/lib/parser.js";
import { AnthropicLLMModel } from "../llm/anthropic-llm";
import { ContentBlockParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import { LoopAgent } from "./loop";
import { ToolUseResult } from "../definitions/tool-definitions.js";
import { LoopMessageParam, LoopState } from "../definitions/definitions";
import { ToolUseDef } from "./services/tool-use-service";

export class AnthropicLoop extends LoopAgent<ContentBlockParam, ParsedMessage<any>, AnthropicLLMModel> {

    protected override createLLMModel(): AnthropicLLMModel {
        return new AnthropicLLMModel(
            this.promptService.provideSystemPrompt(this.isSubLoop),
            this.toolUseService.getAvailableTools()
        );
    }

    protected override convertResponseToMessages(response: ParsedMessage<any>): LoopMessageParam<ContentBlockParam> {
        return {role: 'assistant', content: response.content};
    }

    protected override convertToolResultMessages(toolResults: ToolUseResult[]): LoopMessageParam<ContentBlockParam>[] {
        const content = toolResults.map(toolResult => ({
            type: 'tool_result',
            tool_use_id: toolResult.id,
            content: toolResult.content,
        } as ToolResultBlockParam));
        return [{role: 'user', content: content}];
    }

    protected override extractToolCalls(result: ParsedMessage<any>): ToolUseDef[] {
        const toolUses = result.content.filter(block => block.type === 'tool_use');
        return toolUses.map(toolUse => ({
            id: toolUse.id,
            name: toolUse.name,
            input: toolUse.input as { [key: string]: any }
        }));
    }

    protected override quitLoop(result: ParsedMessage<any>): boolean {
        return result.stop_reason != 'tool_use';
    }
    
    protected override extractFinalText(state: LoopState<ContentBlockParam>): string {
        const texts: string[] = [];
        const message = state.messages[state.messages.length - 1]!;
        for (const block of (message.content as ContentBlockParam[])) {
            if ('text' in block && block.text) {
                texts.push(block.text as string);
            }
        }
        return texts.join("\n");
    }

    override createSubLoop(fork: boolean = false): LoopAgent<ContentBlockParam, ParsedMessage<any>, AnthropicLLMModel> {
        return new AnthropicLoop(() => {}, fork ? this.history : [], true);
    }

}