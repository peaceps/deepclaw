export type FlushAgentConstructor = new (onStreamEvent: (text: string) => void) => FlushAgent;

export abstract class FlushAgent {
    protected onStreamEvent: (text: string, done?: boolean) => void;

    constructor(onStreamEvent: (text: string, done?: boolean) => void = () => {}) {
        this.onStreamEvent = (text: string, done: boolean = false) => onStreamEvent(this.formatLLMText(text), done);
    }

    protected abstract _invoke(input: string): Promise<string>;

    async invoke(input: string): Promise<string> {
        const res = await this._invoke(input);
        return new Promise((resolve) => {
            setTimeout(() => {
                this.onStreamEvent(res, true);
                resolve(res);
            }, 100);
        });
    }
    
    private formatLLMText(text: string): string {
        return !text ? '' : text.replace(/\r\n/g, '\n').trimEnd();
    }
}
