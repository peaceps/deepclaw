import { FileUtils } from '@deepclaw/node-utils';
import { LLMModel } from '../../llm/llmgw';
import { FootPrint, OneLoopContext } from '../../definitions/definitions';
import { HISTORY_DIR } from '../../paths';
import { HISTORY_COMPACT_FILE } from '../../paths';
import { HookManager } from '../services/hook-manager';
import { addTokenUsage, type LLMTransitionReason } from '@deepclaw/core';

/**
 * How many tool results stand as they came back, the rest of them compacted where they are long.
 *
 * Held under `HISTORY_THRESHOLD / TRUNCATE_THRESHOLD`, which is what makes this the first thing
 * that compacts rather than a thing that never gets the chance. A result is capped at
 * `TRUNCATE_THRESHOLD` on its way in, so this many of them at that cap is the most the exempt
 * window can hold; above the history threshold, that window alone would trip the full compaction
 * below, and the free pass here -- a line of text put in place of a result already filed to disk --
 * would never once have run before the expensive one, an llm call that summarizes the conversation
 * and keeps no detail of it, had already run instead.
 */
export const MAX_RECENT_TOOL_RESULT_COUNT: number = 7;
const TOOL_RESULT_THRESHOLD: number = 1200;
const TOOL_RESULT_COMPACTED_MESSAGE: string = '<tool result compacted> Earlier tool result compacted. Re-run the tool if you need full detail.</tool result compacted>';
/**
 * How long the history may be before it is summarized, counted in characters of jsonl.
 *
 * Characters are not what the limit is in, and the two drift apart by the language: four characters
 * of code or English go to about a token, one character of Chinese to about one, so the same number
 * here is a third of a context on one conversation and the whole of it on another. Set for the
 * worse of the two rather than the better, and it is a guess in either case -- nothing here knows
 * what model it is talking to, the window of it being no part of what is configured. The measure
 * that is not a guess arrives as a refused call, and is handled where that refusal lands.
 */
export const HISTORY_THRESHOLD: number = 150000;
const MAX_HISTORY_FILE_COUNT: number = 5;

export abstract class AbstractMessagesCompactor<
    I, O extends {transitionReason: LLMTransitionReason}, R,
    LLM extends LLMModel<I, O, unknown, unknown>
> {

    public compactOldResults(messages: I[], context: OneLoopContext): void {
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

    /**
     * Compacts the history where it has grown past what is carried, and where the caller says so
     * whatever its size.
     *
     * The threshold is a guess at what a model holds, made in characters against a limit counted in
     * tokens, and the two part company by a factor of three or more between a history of code and
     * one of Chinese. So it cannot be the only thing that compacts: a model that has refused the
     * call for a history too long has just measured the real limit, and a history under the guess
     * at that moment would be sent again unchanged, refused again, and again for every turn left.
     * `force` is that measurement arriving, and it compacts a history of any length.
     */
    public async compactFullHistory(
        force: boolean, context: OneLoopContext, footPrints: FootPrint[], llm: LLM, messages: I[]
    ): Promise<void> {
        if (!!messages.length) {
            const lastMessage = messages[messages.length - 1]!;
            const isLastUserMessage = lastMessage && typeof lastMessage === 'object'
                && 'role' in lastMessage && lastMessage.role === 'user';
            const messagesToCompact = isLastUserMessage ? messages.slice(0, messages.length - 1) : messages;

            const jsonl = messagesToCompact.map(message => JSON.stringify(message)).join('\n');
            if ((force && messagesToCompact.length > 0) || jsonl.length > HISTORY_THRESHOLD) {
                this.saveHistory(context.sessionDir, jsonl);
                const summary = await this.summarizeHistory(context, footPrints, llm, jsonl);
                messages.splice(
                    0, messages.length, ...(isLastUserMessage ? [summary, lastMessage] : [summary])
                );
                await HookManager.emitVisitor('historyCompacted', context, jsonl.length);
            }
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
        const {summary, tokenUsage} = await llm.compact(
            context.loopConfig.mode, context.system, jsonl, context.logger, context.abortSignal
        );
        addTokenUsage(context.runtime.usage, tokenUsage);
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
