import { FileUtils } from '@deepclaw/node-utils';
import { LLMModel } from '../../llm/llmgw';
import { FootPrint, OneLoopContext } from '../../definitions/definitions';
import { HISTORY_DIR } from '../../paths';
import { HISTORY_COMPACT_FILE } from '../../paths';
import { HookManager } from '../services/hook-manager';
import { SessionService } from '../services/session-service';
import type { LLMTransitionReason } from '@deepclaw/core';

const MAX_RECENT_TOOL_RESULT_COUNT: number = 20;
const TOOL_RESULT_THRESHOLD: number = 1200;
const TOOL_RESULT_COMPACTED_MESSAGE: string = '<tool result compacted> Earlier tool result compacted. Re-run the tool if you need full detail.</tool result compacted>';
const HISTORY_THRESHOLD: number = 200000;
const MAX_HISTORY_FILE_COUNT: number = 5;

export abstract class AbstractMessagesCompactor<
    I, O extends {transitionReason: LLMTransitionReason}, R,
    LLM extends LLMModel<I, O, unknown, unknown>
> {

    public compactOldResults(messages: I[], context: OneLoopContext): void {
        if (SessionService.isOutdated(context.sessionDir)) return;
        const toolResultMessages = this.getToolResults(messages);
        if (toolResultMessages.length > MAX_RECENT_TOOL_RESULT_COUNT) {
            const oldestResult = toolResultMessages.slice(0, toolResultMessages.length - MAX_RECENT_TOOL_RESULT_COUNT);
            for (const result of oldestResult) {
                const resultLength = this.getContentLength(result);
                if (resultLength > TOOL_RESULT_THRESHOLD) {
                    this.compactToolResult(result, TOOL_RESULT_COMPACTED_MESSAGE);
                    HookManager.emitVisitor('toolResultCompacted', context, resultLength);
                }
            }
        }
    }

    public async compactFullHistory(
        context: OneLoopContext, footPrints: FootPrint[], llm: LLM, messages: I[]
    ): Promise<void> {
        const isOutdated = SessionService.isOutdated(context.sessionDir);
        if (!!messages.length) {
            const lastMessage = messages[messages.length - 1]!;
            const isLastUserMessage = lastMessage && typeof lastMessage === 'object'
                && 'role' in lastMessage && lastMessage.role === 'user';
            const messagesToCompact = isLastUserMessage ? messages.slice(0, messages.length - 1) : messages;

            const jsonl = messagesToCompact.map(message => JSON.stringify(message)).join('\n');
            if ((isOutdated && messagesToCompact.length > 0) || jsonl.length > HISTORY_THRESHOLD) {
                this.saveHistory(context.sessionDir, jsonl);
                const summary = await this.summarizeHistory(context, footPrints, llm, jsonl);
                messages.splice(
                    0, messages.length, ...(isLastUserMessage ? [summary, lastMessage] : [summary])
                );
                await HookManager.emitVisitor('historyCompacted', context, jsonl.length);
            }
        }
        if (isOutdated) {
            SessionService.markNotOutdated(context.sessionDir);
        }
    }

    private saveHistory(sessionDir: string, jsonl: string) {
        const fileName = FileUtils.wrapTimestamp(HISTORY_COMPACT_FILE);
        const filePath = `${sessionDir}/${HISTORY_DIR}/${fileName}`;
        FileUtils.writeFile(filePath, jsonl);
        FileUtils.enforceFileCountLimit(`${sessionDir}/${HISTORY_DIR}`, MAX_HISTORY_FILE_COUNT);
    }

    private async summarizeHistory(
        context: OneLoopContext, footPrints: FootPrint[], llm: LLM, jsonl: string
    ): Promise<I> {
        const {summary, tokenUsage} = await llm.compact(context.loopConfig.mode, context.system, jsonl, context.logger);
        context.runtime.usage.cachedInputTokens += tokenUsage.cachedInputTokens;
        context.runtime.usage.noCachedInputTokens += tokenUsage.noCachedInputTokens;
        context.runtime.usage.outputTokens += tokenUsage.outputTokens;
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
