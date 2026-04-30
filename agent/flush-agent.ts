export const ALL_CONTENT_FLUSHED = '<THIS_IS_FLUSH_DONE_FLAG_FOR_AGENT>';

export abstract class FlushAgent {
    protected onStreamEvent: (text: string) => void = () => {};

    constructor(onStreamEvent: (text: string) => void) {
        this.onStreamEvent = onStreamEvent;
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
}