export class TestLlmAgent {
    private onStreamEvent: (text: string) => void = () => {};

    setStreamHandler(onStreamEvent: (text: string) => void) {
        this.onStreamEvent = onStreamEvent;
    }

    async invoke(): Promise<string> {
        const text = [
            'The pattern continues',
            'up to number 100, with a',
            'similar long sentence',
            'added after every group',
            'of ten numbers. Due to',
            'the format\'s repetitive',
            'nature, only the start',
            'and one instance of the',
            'long sentence have been',
            'shown above.'
        ];
        const k: string[] = [];
        for (let i = 0; i < 100; i++) {
            k.push(`its ${i} The pattern 100\n`);
            if (i > 0 && i % 10 === 0) {
                for (const word of text) {
                    k.push(word + ' ');
                }
                k.push(`...\n`);
            }
        }
        let i = 0;
        return new Promise((resolve) => {
            const interval = setInterval(() => {
                this.onStreamEvent(k[i++]!);
                if (i >= k.length) {
                    clearInterval(interval);
                    resolve('its done\n');
                }
            }, 100);
        });
    }
}