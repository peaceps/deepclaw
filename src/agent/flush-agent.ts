export const ALL_CONTENT_FLUSHED = '<THIS_IS_FLUSH_DONE_FLAG_FOR_AGENT>';

export abstract class FlushAgent {
    protected onStreamEvent: (text: string) => void = () => {};

    constructor(onStreamEvent: (text: string) => void) {
        this.onStreamEvent = (text: string) => onStreamEvent(this.formatLLMText(text));
    }

    protected abstract _invoke(input: string): Promise<string>;

    async invoke(input: string): Promise<string> {
        const res = await this._invoke(input);
        return new Promise((resolve) => {
            setTimeout(() => {
                this.onStreamEvent(ALL_CONTENT_FLUSHED);
                resolve(res);
            }, 100);
        });
    }
    
    private formatLLMText(text: string): string {
        return !text ? '' : text.replace(/\r\n/g, '\n').trimEnd();
    }
}