export type FlushAgentConstructor = new (onStreamText: (text: string) => void) => FlushAgent;

export type AgentEvent = {
    type: 'ask' | 'select';
    text: string;
}

export abstract class FlushAgent {
    protected onStreamText: (text: string, done?: boolean) => void;

    constructor(onStreamText: (text: string, done?: boolean) => void = () => {}) {
        this.onStreamText = (text: string, done: boolean = false) => onStreamText(this.formatLLMText(text), done);
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
