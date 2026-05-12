import { ResponseInputItem } from "openai/resources/responses/responses";
import { ThinkingMessage } from "../../llm/openai-response-llm.js";
import { MessagesCompactor } from "./messages-compactor.js";

export class OpenAIResponseMessagesCompactor extends MessagesCompactor<ThinkingMessage, ResponseInputItem.FunctionCallOutput> {

    protected override getToolResults(messages: ThinkingMessage[]): ResponseInputItem.FunctionCallOutput[] {
        return messages.filter(message => message.type === 'function_call_output');
    }

    protected override getContentLength(message: ResponseInputItem.FunctionCallOutput): number {
        return typeof message.output === 'string' ? message.output.length :
            message.output.filter(block => block.type === 'input_text')
                .map(block => block.text || '')
                .reduce((p, n) => p + n.length, 0);
    }

    protected override compactToolResult(message: ResponseInputItem.FunctionCallOutput): void {
        message.output = this.compactedMessage;
    }

}
