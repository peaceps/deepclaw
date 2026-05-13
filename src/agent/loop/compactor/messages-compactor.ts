import { loadAgentConfig, FileUtils } from '@utils';
import { LLMModel } from '../../llm/llmgw';

export type HistoryCompactContext = {
    count: number;
}

export abstract class MessagesCompactor<I, O, R, LLM extends LLMModel<I, O, unknown, unknown>> {
    protected parentSessionId: string;
    protected sessionId: string;
    private llm: LLM;

    private maxRecent: number = loadAgentConfig<number>('toolResult.removeLegacy.maxRecent');
    private toolResultThreshold: number = loadAgentConfig<number>('toolResult.removeLegacy.lengthThreshold');
    private toolResultCompactedMessage: string = 'Earlier tool result compacted. Re-run the tool if you need full detail.';

    private historyThreshold: number = loadAgentConfig<number>('history.compactThreshold');
    private historyDir: string = loadAgentConfig<string>('history.dir');

    private historyCompactContext: HistoryCompactContext = {
        count: 0
    };

    constructor(llm: LLM, parentSessionId: string, sessionId: string) {
        this.llm = llm;
        this.parentSessionId = parentSessionId;
        this.sessionId = sessionId;
    }
    
    public async compact(messages: I[]): Promise<void> {
        this.compactOldResults(messages);
        await this.compactFullHistory(messages);
    }

    private compactOldResults(messages: I[]): void {
        const toolResultMessages = this.getToolResults(messages);
        if (toolResultMessages.length > this.maxRecent) {
            const oldestResult = toolResultMessages.slice(0, toolResultMessages.length - this.maxRecent);
            for (const result of oldestResult) {
                if (this.getContentLength(result) > this.toolResultThreshold) {
                    this.compactToolResult(result, this.toolResultCompactedMessage);
                }
            }
        }
    }

    private async compactFullHistory(messages: I[]): Promise<void> {
        const jsonl = messages.map(message => JSON.stringify(message)).join('\n');
        if (jsonl.length > this.historyThreshold) {
            this.saveHistory(jsonl);
            const summary = await this.summarizeHistory(jsonl);
            messages.splice(0, messages.length, summary);
        }
    }

    private saveHistory(jsonl: string) {
        const fileName = FileUtils.wrapTimestamp('history_compact.jsonl');
        FileUtils.writeFileToSession(this.parentSessionId, this.sessionId, this.historyDir, fileName, jsonl);
    }

    private async summarizeHistory(jsonl: string): Promise<I> {
        const summary = await this.llm.compact(jsonl);
        this.historyCompactContext.count++;
        return summary;
    }

    protected abstract getToolResults(messages: I[]): R[];

    protected abstract getContentLength(toolResult: R): number;

    protected abstract compactToolResult(toolResult: R, msg: string): void;
}
