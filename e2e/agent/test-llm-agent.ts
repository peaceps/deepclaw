import { FlushAgent } from '../../src/core/flush-agent.js';

export class TestLlmAgent extends FlushAgent {

    protected async _invoke(_: string): Promise<string> {
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
        const lines: string[] = [];
        for (let i = 0; i < 80; i++) {
            lines.push(`its ${i} The pattern 100`);
            if (i > 0 && i % 10 === 0) {
                for (const word of text) {
                    lines.push(word + ' ');
                }
                lines.push(`...`);
            }
        }
        let i = 0;
        return new Promise((resolve) => {
            const interval = setInterval(() => {
                this.onStreamEvent(lines[i++]!);
                if (i >= lines.length) {
                    clearInterval(interval);
                    resolve('its done.');
                }
            }, 100);
        });
    }
}