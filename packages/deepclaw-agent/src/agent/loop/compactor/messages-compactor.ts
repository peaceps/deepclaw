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
            const compactorConstructor = key === 'AnthropicLoop' ? AnthropicMessagesCompactor :
                key === 'OpenAIChatLoop' ? OpenAIChatMessagesCompactor : OpenAIResponseMessagesCompactor;
            this.pool.set(key, new compactorConstructor());
        }

        return this.pool.get(key)!;
        
    }

}
