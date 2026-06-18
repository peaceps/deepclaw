import { AgentInfoEvent, AgentInteractionEvent, AgentStreamEvent } from './flush-agent-event';
import { AgentIdentity } from './agent-definitions';

export type FlushAgentConstructor = new (
    agentIdentity: AgentIdentity,
    handler: AgentHandler
) => FlushAgent;

export type LLMGWConfig = {
    model: string,
    timeoutMs: number, // JSON: seconds → client: ms
    temperature: number,
    maxTokens: number
}

export type AgentHandler = {
    onStreamText(e: AgentStreamEvent): void;
    onToolText(content: string): void;
    onInteractionEvent(event: AgentInteractionEvent): Promise<string|boolean|number>;
    onInfoEvent(event: AgentInfoEvent): void;
}

export type SealedAgentHandler = AgentHandler & {
    onStreamText(e: Omit<AgentStreamEvent, 'done'>): void;
}

export abstract class FlushAgent {
    protected agentHandler: AgentHandler;
    private flusher: (e: AgentStreamEvent & {done: boolean}) => void;

    constructor(
        handler: AgentHandler
    ) {
        this.flusher = (e: AgentStreamEvent & {done: boolean}) => handler.onStreamText({
            chatKey: e.chatKey,
            text: this.formatLLMText(e.text, e.done),
            done: e.done
        });
        this.agentHandler = {
            onStreamText: (e: Omit<AgentStreamEvent, 'done'>) => this.flusher({chatKey: e.chatKey, text: e.text, done: false}),
            onToolText: (text: string) => handler.onToolText(text),
            onInteractionEvent: handler.onInteractionEvent,
            onInfoEvent: handler.onInfoEvent
        };
    }

    protected abstract _invoke(chatKey: string, input: string): Promise<string>;

    async invoke(chatKey: string, input: string): Promise<string> {
        try {
            const res = await this._invoke(chatKey, input);
            return this.finishInvoke(chatKey, res);
        } catch (e: any) {
            return this.finishInvoke(chatKey, e?.message || '');
        }
    }

    private finishInvoke(chatKey: string, content: string): Promise<string> {
        return new Promise((resolve) => {
            setTimeout(() => {
                this.flusher({chatKey, text: content, done: true});
                resolve(content);
            }, 100);
        });
    }
    
    private formatLLMText(text: string, done: boolean): string {
        if (!text) return '';
        let result = text.replace(/\r\n/g, '\n');
        if (done) {
            result = result.trimEnd();
        }
        return result;
    }

    public abstract getIdentity(): AgentIdentity;
}
