export type FlushAgentConstructor = new (
    onStreamText: (text: string) => void,    
    onAgentEvent: (event: AgentEvent) => Promise<string>
) => FlushAgent;

export type AgentEvent = {
    type: 'readonly';
    content: string;
} | {
    type: 'input';
    content: string;
} | {
    type: 'select';
    content: string;
    options: (string | {label: string; value: string})[];
}

export abstract class FlushAgent {
    protected onStreamText: (text: string, done?: boolean) => void;
    protected onAgentEvent: (event: AgentEvent) => Promise<string>;

    constructor(
        onStreamText: (text: string, done?: boolean) => void = () => {},
        onAgentEvent: (event: AgentEvent) => Promise<string> = () => Promise.resolve('')
    ) {
        this.onStreamText = (text: string, done: boolean = false) => onStreamText(this.formatLLMText(text), done);
        this.onAgentEvent = onAgentEvent;
    }

    protected abstract _invoke(input: string): Promise<string>;

    async invoke(input: string): Promise<string> {
        const res = await this._invoke(input);
        return new Promise((resolve) => {
            setTimeout(() => {
                this.onStreamText(res, true);
                resolve(res);
            }, 100);
        });
    }
    
    private formatLLMText(text: string): string {
        return !text ? '' : text.replace(/\r\n/g, '\n').trimEnd();
    }
}
