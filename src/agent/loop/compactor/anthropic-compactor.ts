import { 
    ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import { ThinkingMessage } from "../../llm/anthropic-llm.js";
import { MessagesCompactor } from "./messages-compactor.js";

export class AnthropicMessagesCompactor extends MessagesCompactor<ThinkingMessage, ToolResultBlockParam> {

    protected override getToolResults(messages: ThinkingMessage[]): ToolResultBlockParam[] {
        return messages.map(message => message.content)
            .filter(block => typeof block !== 'string')
            .flatMap(message => message)
            .filter(block => block.type === 'tool_result');
    }

    protected override getContentLength(message: ToolResultBlockParam): number {
        return typeof message.content === 'string' ? message.content.length :
            (message.content ?? []).map(block => block.type === 'text' ? block.text : '')
            .reduce((p, n) => p + n.length, 0);
    }

    protected override compactToolResult(message: ToolResultBlockParam): void {
        message.content = this.compactedMessage;
    }    

}
