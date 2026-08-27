import { 
    ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import { ThinkingMessage, ThinkingResponse, AnthropicLLM } from "../../llm/anthropic-llm";
import { AbstractMessagesCompactor } from "./abstract-messages-compactor";

export class AnthropicMessagesCompactor extends AbstractMessagesCompactor<ThinkingMessage, ThinkingResponse, ToolResultBlockParam, AnthropicLLM> {

    /**
     * Blocks are read off whatever carries them and nothing is assumed of the rest. A history is
     * not always in the shape this compactor is for: point an agent at another base url and its
     * protocol changes under a conversation written in the one before, and until that conversation
     * has been migrated every message in it is some other model's. The two compactors beside this
     * one pick their results out by a field of their own that no foreign message has, so they pass
     * over what they do not recognize; this one reached into every message for a content that a
     * response item need not have, and a run that met one died of a type error in the middle of a
     * turn -- the loop that would have migrated the history killed by the history it was about to
     * migrate.
     */
    protected override getToolResults(messages: ThinkingMessage[]): ToolResultBlockParam[] {
        return messages.flatMap(message => Array.isArray(message?.content) ? message.content : [])
            .filter(block => block?.type === 'tool_result');
    }

    protected override getContentLength(message: ToolResultBlockParam): number {
        return typeof message.content === 'string' ? message.content.length :
            (message.content ?? []).map(block => block.type === 'text' ? block.text : '')
            .reduce((p, n) => p + n.length, 0);
    }

    protected override compactToolResult(message: ToolResultBlockParam, msg: string): void {
        message.content = msg;
    }

}
