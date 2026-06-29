import { AbstractMessagesCompactor } from "./abstract-messages-compactor";
import { AnthropicMessagesCompactor } from "./anthropic-compactor";
import { OpenAIChatMessagesCompactor } from "./openai-chat-compactor";
import { OpenAIResponseMessagesCompactor } from "./openai-response-compactor";
import { LLMProtocol } from "../../definitions/definitions";

export class MessageCompactor {
    private static pool: Map<string, AbstractMessagesCompactor<any, any, any, any>> = new Map();

    public static getCompactor(protocol: LLMProtocol): AbstractMessagesCompactor<any, any, any, any> {
        if (!this.pool.has(protocol)) {
            switch (protocol) {
                case 'Anthropic':
                    this.pool.set(protocol, new AnthropicMessagesCompactor());
                    break;
                case 'OpenAIChat':
                    this.pool.set(protocol, new OpenAIChatMessagesCompactor());
                    break;
                case 'OpenAIResponse':
                    this.pool.set(protocol, new OpenAIResponseMessagesCompactor());
                    break;
                default:
                    throw new Error(`Unknown loop type: ${protocol}`);
            }
        }
        return this.pool.get(protocol)!;
    }

}
