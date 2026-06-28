import { FileUtils, type Logger } from '@deepclaw/node-utils';
import { LLMModel } from '../../llm/llmgw';
import { FootPrint } from '../../definitions/definitions';
import { HISTORY_DIR } from '../../paths';
import { HISTORY_COMPACT_FILE } from '../../paths';
import { DeepclawConfig } from '@deepclaw/config';

export abstract class AbstractMessagesCompactor<I, O, R, LLM extends LLMModel<I, O, unknown, unknown>> {
    private maxRecent: number = 20;
    private toolResultThreshold: number = 1200;
    private toolResultCompactedMessage: string = '<tool result compacted> Earlier tool result compacted. Re-run the tool if you need full detail.</tool result compacted>';

    private historyThreshold: number = 200000;

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
        sessionDir: string, footPrints: FootPrint[], mode: DeepclawConfig['agents'][0]['mode'],
        llm: LLM, system: string, messages: I[], logger: Logger
    ): Promise<void> {
        const jsonl = messages.map(message => JSON.stringify(message)).join('\n');
        if (jsonl.length > this.historyThreshold) {
            this.saveHistory(sessionDir, jsonl);
            const summary = await this.summarizeHistory(mode, footPrints, llm, system, jsonl, logger);
            messages.splice(0, messages.length, summary);
        }
    }

    private saveHistory(sessionDir: string, jsonl: string) {
        const fileName = FileUtils.wrapTimestamp(HISTORY_COMPACT_FILE);
        const filePath = `${sessionDir}/${HISTORY_DIR}/${fileName}`;
        FileUtils.writeFile(filePath, jsonl);
    }

    private async summarizeHistory(
        mode: DeepclawConfig['agents'][0]['mode'], footPrints: FootPrint[],
        llm: LLM, system: string, jsonl: string, logger: Logger
    ): Promise<I> {
        const summary = await llm.compact(mode, system, jsonl, logger);
        return llm.newInputMessage(`
This session continues from a previous conversation that was compacted.
This conversation was compacted so the agent can continue working.
Summary of prior context:

${summary}

The action trace of the conversation:
${this.getFootPrintsText(footPrints)}

Continue from where we left off without re-asking the user.`);
    }

    private getFootPrintsText(footPrints: FootPrint[]): string {
        const readFiles = footPrints.filter(footPrint => footPrint.type === 'read_file')
            .map(footPrint => `- ${footPrint.content}`).join('\n');
        return readFiles.length === 0 ? '' : `The agent read the following files:
${readFiles}
If needed, you can read the full content of these files by using the read_file tool.`;
    }

    protected abstract getToolResults(messages: I[]): R[];

    protected abstract getContentLength(toolResult: R): number;

    protected abstract compactToolResult(toolResult: R, msg: string): void;
}
