import { FileUtils, type Logger } from '@deepclaw/node-utils';
import { LLMModel } from '../../llm/llmgw';
import { FootPrint } from '../../definitions/definitions';
import { AGENTS_DIR, HISTORY_DIR, SESSION_DIR } from '../../paths';
import { HISTORY_COMPACT_FILE } from '../../paths';
import { DeepclawConfig } from '@deepclaw/config';

type HistoryCompactContext = {
    footPrints: FootPrint[];
    count: number;
}

export abstract class MessagesCompactor<I, O, R, LLM extends LLMModel<I, O, unknown, unknown>> {
    protected parentSessionId: string;
    protected sessionId: string;
    protected agentId: string;

    private maxRecent: number = 20;
    private toolResultThreshold: number = 1200;
    private toolResultCompactedMessage: string = '<tool result compacted> Earlier tool result compacted. Re-run the tool if you need full detail.</tool result compacted>';

    private historyThreshold: number = 200000;
    private historyCompactContext: HistoryCompactContext;

    constructor(agentId: string, parentSessionId: string, sessionId: string, footPrints: FootPrint[]) {
        this.agentId = agentId;
        this.parentSessionId = parentSessionId;
        this.sessionId = sessionId;
        this.historyCompactContext = {
            footPrints,
            count: 0
        };
    }

    public compactOldResults(messages: I[]): void {
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

    public async compactFullHistory(
        mode: DeepclawConfig['agents'][0]['mode'],
        llm: LLM, system: string, messages: I[], logger: Logger
    ): Promise<void> {
        const jsonl = messages.map(message => JSON.stringify(message)).join('\n');
        if (jsonl.length > this.historyThreshold) {
            this.saveHistory(jsonl);
            const summary = await this.summarizeHistory(mode, llm, system, jsonl, logger);
            messages.splice(0, messages.length, summary);
        }
    }

    private saveHistory(jsonl: string) {
        const fileName = FileUtils.wrapTimestamp(HISTORY_COMPACT_FILE);
        const filePath = `${AGENTS_DIR}/${this.agentId}/${SESSION_DIR}/${this.parentSessionId}/${this.sessionId}/${HISTORY_DIR}/${fileName}`;
        FileUtils.writeFile(filePath, jsonl);
    }

    private async summarizeHistory(
        mode: DeepclawConfig['agents'][0]['mode'],
        llm: LLM, system: string, jsonl: string, logger: Logger
    ): Promise<I> {
        const summary = await llm.compact(mode, system, jsonl, logger);
        this.historyCompactContext.count++;
        return llm.newInputMessage(`
This session continues from a previous conversation that was compacted.
This conversation was compacted so the agent can continue working.
Summary of prior context:

${summary}

The action trace of the conversation:
${this.getFootPrintsText()}

Continue from where we left off without re-asking the user.`);
    }

    private getFootPrintsText(): string {
        const readFiles = this.historyCompactContext.footPrints
            .filter(footPrint => footPrint.type === 'read_file')
            .map(footPrint => `- ${footPrint.content}`).join('\n');
        return readFiles.length === 0 ? '' : `The agent read the following files:
${readFiles}
If needed, you can read the full content of these files by using the read_file tool.`;
    }

    protected abstract getToolResults(messages: I[]): R[];

    protected abstract getContentLength(toolResult: R): number;

    protected abstract compactToolResult(toolResult: R, msg: string): void;
}
