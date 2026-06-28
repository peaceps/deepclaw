import { FlushAgent } from "@deepclaw/core";
import { AbstractMessagesCompactor } from "./abstract-messages-compactor";
import { AnthropicMessagesCompactor } from "./anthropic-compactor";
import { OpenAIChatMessagesCompactor } from "./openai-chat-compactor";
import { OpenAIResponseMessagesCompactor } from "./openai-response-compactor";

export class MessageCompactor {
    private static pool: Map<string, AbstractMessagesCompactor<any, any, any, any>> = new Map();

    public static getCompactor(loop: FlushAgent): AbstractMessagesCompactor<any, any, any, any> {
        const key = loop.constructor.name;
        if (!this.pool.has(key)) {
            switch (key) {
                case 'AnthropicLoop':
                    this.pool.set(key, new AnthropicMessagesCompactor());
                    break;
                case 'OpenAIChatLoop':
                    this.pool.set(key, new OpenAIChatMessagesCompactor());
                    break;
                case 'OpenAIResponseLoop':
                    this.pool.set(key, new OpenAIResponseMessagesCompactor());
                    break;
                default:
                    throw new Error(`Unknown loop type: ${key}`);
            }
        }
        return this.pool.get(key)!;
    }

}
