import { FileUtils } from '@deepclaw/node-utils';
import { LLMModel } from '../../llm/llmgw';
import { FootPrint, OneLoopContext } from '../../definitions/definitions';
import { HISTORY_DIR } from '../../paths';
import { HISTORY_COMPACT_FILE } from '../../paths';
import { HookManager } from '../services/hook-manager';
import { addTokenUsage, type LLMTransitionReason } from '@deepclaw/core';
import { estimateTokens } from '../../loop-utils';
import {
    MAX_REQUEST_BYTES, UNLEARNED_TOKEN_BUDGET, type WindowBudget
} from '../services/llm-window-service';

/**
 * How much of a history too long to summarize goes to its opening, the rest going to its end.
 *
 * Both ends and not one, for the reason a filed away tool result is previewed from both: the answer
 * can be at either. What the summarizer is asked for begins with the goal and the constraints of
 * the user, which are stated once, at the start, and never again -- an agent that loses those has
 * nothing left to aim at and will ask for them back or quietly drift -- and ends with the step to
 * take next, which is at the end by definition.
 *
 * Uneven, where the preview of a tool result splits evenly, because the two ends are not asked for
 * the same amount here. The opening has to carry a goal and a handful of constraints and then stops
 * earning its room; the end is the working state of the run and keeps being worth reading a long
 * way back.
 */
const HEAD_SHARE = 0.25;

/** Said in place of what was left out, so that a part is not read as the whole. */
function omittedNote(messageCount: number): string {
    return `<${messageCount} earlier messages omitted: too long to summarize, archived in full to `
        + 'the session history>';
}

/** What one line of jsonl costs, in both of the units something at the far end may refuse over. */
function costOf(line: string): WindowBudget {
    // The break it is joined back by counts as well, in both units, being one of each.
    return {tokens: estimateTokens(line) + 1, bytes: Buffer.byteLength(line, 'utf8') + 1};
}

function added(spent: WindowBudget, cost: WindowBudget): WindowBudget {
    return {tokens: spent.tokens + cost.tokens, bytes: spent.bytes + cost.bytes};
}

function spend(spent: WindowBudget, cost: WindowBudget): void {
    spent.tokens += cost.tokens;
    spent.bytes += cost.bytes;
}

function within(cost: WindowBudget, budget: WindowBudget): boolean {
    return cost.tokens <= budget.tokens && cost.bytes <= budget.bytes;
}

/**
 * How many tool results stand as they came back, the rest of them compacted where they are long.
 *
 * Held under `UNLEARNED_TOKEN_BUDGET / TRUNCATE_THRESHOLD`, which is what makes this the first
 * thing that compacts rather than a thing that never gets the chance. A result is capped at
 * `TRUNCATE_THRESHOLD` characters on its way in, so this many of them at that cap is the most the
 * exempt window can hold; over the budget, that window alone would trip the full compaction below,
 * and the free pass here -- a line of text put in place of a result already filed to disk -- would
 * never once have run before the expensive one, an llm call that summarizes the conversation and
 * keeps no detail of it, had already run instead.
 *
 * The budget is counted in tokens and the cap in characters, so the comparison is made at the
 * worst rate the two meet at, a character to a token, which is chinese. Anything else has room to
 * spare.
 */
export const MAX_RECENT_TOOL_RESULT_COUNT: number = 7;
const TOOL_RESULT_THRESHOLD: number = 1200;
const TOOL_RESULT_COMPACTED_MESSAGE: string = '<tool result compacted> Earlier tool result compacted. Re-run the tool if you need full detail.</tool result compacted>';
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
     * What is weighed here is the bytes of the request, against the limit of whatever gateway
     * stands in front of the model. Bytes and not characters: `JSON.stringify` leaves non-ascii
     * text as it found it, so a character of chinese is one character of the jsonl and three bytes
     * of what goes over the wire, and a limit of six megabytes measured in characters is a limit
     * of eighteen.
     *
     * The window of the model is the other question and is not asked here. It is counted in tokens,
     * and the exact count of them belongs to the caller, which has what the model reported; it
     * arrives as `force`, as does a refusal. Asking it here as well, off the estimate, would be
     * asking it of the history as it stands this moment -- and a gate that binds the history every
     * turn is a gate no request ever gets past, which is to say no request ever proves the window
     * wider than the gate. The lag in the caller's count is what leaves room to learn.
     *
     * Answers with whether the history it was given is now a history this model can be sent, which
     * is false in one case only: a summary was asked for and what came back was not one. The
     * caller migrating a session between protocols reads it as the migration having happened,
     * because the summary is the whole of the conversion -- old messages out, one message in this
     * model's own shape in. A history left in place is a history still in the shape of the model
     * before it, however the caller has already marked it. Nothing to compact counts as done: an
     * empty history is in no protocol at all, and there is no further call that would make it so.
     */
    public async compactFullHistory(
        force: boolean, context: OneLoopContext, footPrints: FootPrint[], llm: LLM, messages: I[],
        budget: WindowBudget = {tokens: UNLEARNED_TOKEN_BUDGET, bytes: MAX_REQUEST_BYTES}
    ): Promise<boolean> {
        if (!!messages.length) {
            const lastMessage = messages[messages.length - 1]!;
            const isLastUserMessage = lastMessage && typeof lastMessage === 'object'
                && 'role' in lastMessage && lastMessage.role === 'user';
            const messagesToCompact = isLastUserMessage ? messages.slice(0, messages.length - 1) : messages;

            const jsonl = messagesToCompact.map(message => JSON.stringify(message)).join('\n');
            if ((force && messagesToCompact.length > 0) || Buffer.byteLength(jsonl, 'utf8') > budget.bytes) {
                const summary = await this.summarizeHistory(
                    context, footPrints, llm, jsonl, budget
                );
                if (!summary) {
                    return false;
                }
                // Written where the messages are about to be lost and not before. This is the one
                // copy of what a summary replaces, but only where a summary replaces something: a
                // compaction that failed leaves the history in place, and the session writes that
                // out at the end of the turn as it does every turn, so archiving it here would be
                // a second copy of a file that already exists. Worse than idle, at five archives
                // kept: the run that gives up attempts this three times, and three copies of an
                // unchanged history would push the archives of real compactions out.
                this.saveHistory(context.sessionDir, jsonl);
                messages.splice(
                    0, messages.length, ...(isLastUserMessage ? [summary, lastMessage] : [summary])
                );
                await HookManager.emitVisitor('historyCompacted', context, jsonl.length);
            }
        }
        return true;
    }

    /**
     * Both ends of the history, as much of each as the far end is thought to take, whole where the
     * whole of it fits.
     *
     * Against both budgets and not just the window, because a refusal can come from either and the
     * way out of both runs through here. A gateway that named a limit on the bytes of a request
     * named nothing about tokens, so trimming by tokens alone would send a summarizer call of
     * exactly the byte count that was just refused, and the compaction meant to rescue the run
     * would be refused for the same reason the run was.
     *
     * Cut on the line breaks, every one of which is a message boundary in jsonl, so what goes out
     * is whole messages rather than a message ending mid-token. The end is filled after the opening
     * and out of everything the opening left over, so a conversation that opens on something short
     * spends the difference where it is worth most. One message is kept whatever it measures: a
     * single message over the whole budget is a refusal either way, and an empty summarizer call is
     * a refusal for nothing.
     */
    private fitToBudget(jsonl: string, budget: WindowBudget): string {
        if (within(costOf(jsonl), budget)) {
            return jsonl;
        }
        const lines = jsonl.split('\n');
        const costs = lines.map(line => costOf(line));
        const opening = {
            tokens: Math.floor(budget.tokens * HEAD_SHARE),
            bytes: Math.floor(budget.bytes * HEAD_SHARE),
        };
        const spent = {tokens: 0, bytes: 0};
        let headEnd = 0;
        while (headEnd < lines.length && within(added(spent, costs[headEnd]!), opening)) {
            spend(spent, costs[headEnd]!);
            headEnd++;
        }
        let tailStart = lines.length;
        while (tailStart > headEnd && within(added(spent, costs[tailStart - 1]!), budget)) {
            spend(spent, costs[tailStart - 1]!);
            tailStart--;
        }
        if (tailStart === lines.length) {
            tailStart--;
        }
        const omitted = tailStart - headEnd;
        return [
            ...lines.slice(0, headEnd),
            ...(omitted > 0 ? [omittedNote(omitted)] : []),
            ...lines.slice(tailStart),
        ].join('\n');
    }

    private saveHistory(sessionDir: string, jsonl: string) {
        const fileName = FileUtils.wrapTimestamp(HISTORY_COMPACT_FILE);
        const filePath = `${sessionDir}/${HISTORY_DIR}/${fileName}`;
        FileUtils.writeFile(filePath, jsonl);
        FileUtils.enforceFileCountLimit(`${sessionDir}/${HISTORY_DIR}`, MAX_HISTORY_FILE_COUNT);
    }

    /**
     * The summary, or nothing where what came back was not one.
     *
     * Nothing is the important half. The conversation is replaced by whatever this returns, so a
     * refusal taken at face value would throw the conversation away and leave a single sentence
     * about why it could not be shortened in its place. Leaving the history alone lets the caller
     * be refused again and give up saying so, which loses the run but not the conversation.
     *
     * That backstop is a last resort and not the plan. The conversation goes out whole in one
     * message here, so the call meant to shorten a history too long for the model is a call too
     * long for it too -- and the way a window gets learned at all is by a conversation growing into
     * it, which means the compaction that follows the refusal is exactly the one most likely to be
     * refused in turn. Sending only as much as the far end is now known to take is what keeps the
     * run alive at the moment it finally finds out how much that is. What is left out is not lost
     * with it: nothing replaces the history until the archive of it has been written, so the whole
     * of what was trimmed away can be read back off the disk.
     */
    private async summarizeHistory(
        context: OneLoopContext, footPrints: FootPrint[], llm: LLM, jsonl: string,
        budget: WindowBudget
    ): Promise<I | undefined> {
        const {summary, tokenUsage, usable} = await llm.compact(
            context.loopConfig.mode, context.system, this.fitToBudget(jsonl, budget),
            context.logger, context.abortSignal
        );
        addTokenUsage(context.runtime.usage, tokenUsage);
        if (!usable) {
            context.logger.error({summary}, 'History compaction failed, keeping the history as it was');
            return undefined;
        }
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
