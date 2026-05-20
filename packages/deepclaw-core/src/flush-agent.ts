export type FlushAgentConstructor = new (
    handler: AgentStreamHandler
) => FlushAgent;

export type AgentEvent = {
    content: string;
    key?: string;
} & ({
    type: 'readonly';
} | {
    type: 'input';
} | {
    type: 'select';
    options: (string | {label: string; value: string})[];
});

export type AgentStreamHandler = {
    onText(content: string, done?: boolean): void;
    onEvent(event: AgentEvent): Promise<string>;
}

export type SealedAgentStreamHandler = {
    onText(content: string): void;
    onEvent(event: AgentEvent): Promise<string>;
}

export const noopStreamHandler: AgentStreamHandler = {
    onText: () => {},
    onEvent: () => Promise.resolve(''),
}

export abstract class FlushAgent {
    protected streamHandler: SealedAgentStreamHandler;
    private flusher: (content: string, done: boolean) => void;

    constructor(
        handler: AgentStreamHandler
    ) {
        this.flusher = (text: string, done: boolean) => handler.onText(this.formatLLMText(text), done),
        this.streamHandler = {
            onText: (text: string) => this.flusher(text, false),
            onEvent: handler.onEvent
        }
    }

    protected abstract _invoke(input: string): Promise<string>;

    async invoke(input: string): Promise<string> {
        try {
            const res = await this._invoke(input);
            return this.finishInvoke(res);
        } catch (e: any) {
            return this.finishInvoke(e?.message || '');
        }
    }

    private finishInvoke(content: string): Promise<string> {
        return new Promise((resolve) => {
            setTimeout(() => {
                this.flusher(content, true);
                resolve(content);
            }, 100);
        });
    }
    
    private formatLLMText(text: string): string {
        return !text ? '' : text.replace(/\r\n/g, '\n').trimEnd();
    }
}
