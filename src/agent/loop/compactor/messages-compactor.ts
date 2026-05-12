import { loadAgentConfig } from '@utils';

export abstract class MessagesCompactor<I, R> {
    private maxRecent: number = loadAgentConfig<number>('tool_result.removeLegacy.maxRecent') || 3;
    private lengthThreshold: number = loadAgentConfig<number>('tool_result.removeLegacy.lengthThreshold') || 120;
    protected compactedMessage: string = 'Earlier tool result compacted. Re-run the tool if you need full detail.';
    
    public compactBeforeTurn(messages: I[]): void {
        this.compactOldResults(messages);
    }

    private compactOldResults(messages: I[]): void {
        const toolResultMessages = this.getToolResults(messages);
        if (toolResultMessages.length > this.maxRecent) {
            const oldestResult = toolResultMessages.slice(0, toolResultMessages.length - this.maxRecent);
            for (const result of oldestResult) {
                if (this.getContentLength(result) > this.lengthThreshold) {
                    this.compactToolResult(result);
                }
            }
        }
    }

    protected abstract getToolResults(messages: I[]): R[];

    protected abstract getContentLength(toolResult: R): number;

    protected abstract compactToolResult(toolResult: R): void;
}
