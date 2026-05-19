import {
    ChatCompletionToolMessageParam,
 } from 'openai/resources/chat/completions.js';
import { ThinkingMessage, ThinkingResponse, OpenAIChatLLM } from "../../llm/openai-chat-llm.js";
import { MessagesCompactor } from "./messages-compactor.js";

export class OpenAIChatMessagesCompactor extends MessagesCompactor<ThinkingMessage, ThinkingResponse, ChatCompletionToolMessageParam, OpenAIChatLLM> {

    protected override getToolResults(messages: ThinkingMessage[]): ChatCompletionToolMessageParam[] {
        return messages.filter(message => message.role === 'tool');
    }

    protected override getContentLength(message: ChatCompletionToolMessageParam): number {
        return typeof message.content === 'string' ? message.content.length :
            message.content.map(block => block.text || '').reduce((p, n) => p + n.length, 0);
    }

    protected override compactToolResult(message: ChatCompletionToolMessageParam, msg: string): void {
        message.content = msg;
    }

}
