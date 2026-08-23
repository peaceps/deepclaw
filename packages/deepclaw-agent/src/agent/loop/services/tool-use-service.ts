import { FileUtils } from '@deepclaw/node-utils';
import { ToolUseResult, ToolUseDef, ToolDesc, toolRunOf } from "../../definitions/tool-definitions";
import { OneLoopContext } from '../../definitions/definitions';
import { TOOL_RESULT_DIR } from '../../paths';
import { TRUNCATE_THRESHOLD } from '../../loop-utils';
import { ToolsManager } from './tools-manager';
import { HookManager } from './hook-manager';
import {
    type AgentInteractionEventPayload, type InternalInterruptReason,
    isInternalInterruptReason, isInvalidInteractionReason
} from '@deepclaw/core';

export type ToolUseServiceResult = {
    result: ToolUseResult;
    success: boolean;
}

/** What a guard that had to ask ends up with, once the user answered or the guard changed its mind. */
type GuardVerdict = {answer: 'allowed' | 'rejected'} | {answer: 'denied', reason: string};

const PREVIEW_CHAR_LENGTH = 1000;
const MAX_PARALLEL_TOOL_CALLS = 5;

export class ToolUseService {

    private static questionQueues: Map<string, Promise<unknown>> = new Map();
    /**
     * The loops that already found nobody there. Questions are asked one at a time, so without this
     * every tool call queued behind the one that timed out would spend the same ten minutes on the
     * same silence: a run with a tree of subagents would be away for an afternoon to learn what the
     * first question learned. They give up at once instead, until an answer comes or a run is asked
     * for anew.
     */
    private static awayUsers: Set<string> = new Set();

    /** Somebody wants something of this loop, so it is worth asking them again. */
    public static clearAwayUser(loopId: string): void {
        this.awayUsers.delete(loopId);
    }

    /**
     * Puts a question of a tool to the user and answers with what they said. It waits in the same
     * queue a permission question waits in, since both of them are this loop asking the one user,
     * and it gives up on the same silence: whoever was not there for the last question is not
     * asked to be there for this one.
     */
    public static askQuestion(
        question: AgentInteractionEventPayload, context: OneLoopContext
    ): Promise<string> {
        return this.enqueueQuestion(context.loopId, () => this.putQuestion(question, context));
    }

    /**
     * Splits the tool calls of one turn into groups meant to be run one group after the other.
     * Tools that declare themselves parallel safe share a group, every other tool call gets a
     * group of its own so that no other tool call runs while it does. A group is as wide as the
     * narrowest tool in it allows, so the calls beyond that are left for the group after it.
     */
    public static planExecutionGroups(toolUseDefs: ToolUseDef[], context: OneLoopContext): ToolUseDef[][] {
        const groups: ToolUseDef[][] = [];
        let parallel: ToolUseDef[] | undefined;
        let maxParallel = MAX_PARALLEL_TOOL_CALLS;
        const run = toolRunOf(context);
        for (const toolUseDef of toolUseDefs) {
            const tool = ToolsManager.getToolDesc(run, toolUseDef.name);
            if (!tool?.parallelSafe) {
                parallel = undefined;
                groups.push([toolUseDef]);
                continue;
            }
            const limit = Math.min(maxParallel, tool.maxParallel ?? MAX_PARALLEL_TOOL_CALLS);
            if (parallel && parallel.length < limit) {
                maxParallel = limit;
                parallel.push(toolUseDef);
            } else {
                maxParallel = tool.maxParallel ?? MAX_PARALLEL_TOOL_CALLS;
                parallel = [toolUseDef];
                groups.push(parallel);
            }
        }
        return groups;
    }

    public static async executeToolCall(toolUseDef: ToolUseDef, context: OneLoopContext): Promise<ToolUseServiceResult> {
        const tool = ToolsManager.getToolDesc(toolRunOf(context), toolUseDef.name);
        if (!tool) {
            return this.toolResult(toolUseDef.id, `Unknown tool: ${toolUseDef.name}`, false);
        }
        let input = toolUseDef.input || '{}';
        if (typeof input === 'string') {
            try {
                input = JSON.parse(input);
            } catch (error) {
                return this.toolResult(toolUseDef.id, `Parse input to JSON failed: ${input}. Error: ${error}`, false);
            }
        }
        const refusal = await this.checkGuard(tool, input, toolUseDef, context);
        if (refusal) {
            return refusal;
        }
        try {
            const output = await tool.invoke(input, context);
            const truncated = this.truncateLargeOutput(toolUseDef.id, output, context.sessionDir);
            return this.toolResult(toolUseDef.id, truncated, true);
        } catch (error) {
            return this.toolResult(toolUseDef.id, `Error: ${error}`, false);
        }
    }

    private static async checkGuard(
        tool: ToolDesc<any>, input: unknown, toolUseDef: ToolUseDef, context: OneLoopContext
    ): Promise<ToolUseServiceResult | undefined> {
        if (!tool.guard) {
            return undefined;
        }
        const guardResult = tool.guard(input, context);
        if (guardResult.result === 'denied') {
            return this.deny(toolUseDef, guardResult.reason, context);
        }
        if (guardResult.result === 'allowed') {
            return undefined;
        }
        // A schedule is a permission given in advance: whoever set the task up will not be there
        // when it runs, and a run that asks anyway spends its tools on questions nobody hears. What
        // the guard refuses outright is refused here too, this only covers what it would have asked.
        if (context.role === 'cron') {
            context.logger.info(`Cron run granted ${tool.tool.name} without asking.`);
            return undefined;
        }
        try {
            const verdict = await this.askUser(tool, input, context);
            if (verdict.answer === 'denied') {
                return this.deny(toolUseDef, verdict.reason, context);
            }
            if (verdict.answer === 'rejected') {
                return this.toolResult(toolUseDef.id, `Execution of tool ${tool.tool.name} is rejected by user.`, false);
            }
            return undefined;
        } catch (error: any) {
            // A question nobody answered in time is the end of that tool call, not of the run: what
            // asked for the permission is told it never came and decides what that means. Stopping
            // the run instead would be the same thing everywhere except in a spawned loop, which
            // has no session to be continued in and would lose the whole task it was handed.
            if (isInternalInterruptReason(error)) {
                return this.toolResult(
                    toolUseDef.id,
                    `Nobody answered the permission question for ${tool.tool.name} in time, so it was not run.`,
                    false
                );
            }
            // A run with no browser behind it has nobody to hear the question, and is told so at
            // once instead of after the ten minutes it would have spent finding out.
            if (isInvalidInteractionReason(error)) {
                return this.toolResult(
                    toolUseDef.id,
                    `There is nobody to ask for the permission to run ${tool.tool.name}, so it was not run.`,
                    false
                );
            }
            return this.toolResult(toolUseDef.id, `Error, wait for user response failed: ${error}`, false);
        }
    }

    private static async deny(
        toolUseDef: ToolUseDef, reason: string, context: OneLoopContext
    ): Promise<ToolUseServiceResult> {
        await HookManager.emitVisitor('toolGuardDenied', context, {toolUseDef, reason});
        return this.toolResult(toolUseDef.id, `Tool run is not allowed: ${toolUseDef.name}. ${reason}.`, false);
    }

    /**
     * The guard is asked again once the question is at the front of the queue, and its second
     * word is the one that counts: while an earlier tool call was waiting for an answer the user
     * may already have granted the permission, or the tool may have lost it altogether.
     */
    private static askUser(
        tool: ToolDesc<any>, input: unknown, context: OneLoopContext
    ): Promise<GuardVerdict> {
        return this.enqueueQuestion(context.loopId, async (): Promise<GuardVerdict> => {
            const guardResult = tool.guard!(input, context);
            if (guardResult.result === 'allowed') {
                return {answer: 'allowed'};
            }
            if (guardResult.result === 'denied') {
                return {answer: 'denied', reason: guardResult.reason};
            }
            const choice = await this.putQuestion(guardResult.question, context);
            return {answer: guardResult.checkAnswer(choice) ? 'allowed' : 'rejected'};
        });
    }

    /** The asking itself, which belongs inside a slot of the queue rather than beside it. */
    private static async putQuestion(
        question: AgentInteractionEventPayload, context: OneLoopContext
    ): Promise<string> {
        if (this.awayUsers.has(context.loopId)) {
            throw 'interactionAfk' satisfies InternalInterruptReason;
        }
        try {
            const answer = await context.actions.agentHandler.onInteractionEvent(
                { ...question, browserId: context.browserId }
            );
            this.awayUsers.delete(context.loopId);
            return answer;
        } catch (error: any) {
            if (isInternalInterruptReason(error)) {
                this.awayUsers.add(context.loopId);
            }
            throw error;
        }
    }

    /** A loop asks the user one question at a time, two of them would fight over the same browser. */
    private static enqueueQuestion<T>(loopId: string, ask: () => Promise<T>): Promise<T> {
        const answer = (this.questionQueues.get(loopId) ?? Promise.resolve()).then(ask);
        const settled = answer.then(() => undefined, () => undefined);
        this.questionQueues.set(loopId, settled);
        settled.then(() => {
            if (this.questionQueues.get(loopId) === settled) {
                this.questionQueues.delete(loopId);
            }
        });
        return answer;
    }

    private static toolResult(toolUseId: string, content: string, success: boolean): ToolUseServiceResult {
        return ({
            result: {id: toolUseId, content},
            success
        });
    }

    private static truncateLargeOutput(toolUseId: string, output: string, sessionDir: string): string {
        if (output.length <= TRUNCATE_THRESHOLD) {
            return output;
        }
        const fileName = FileUtils.wrapTimestamp(`${toolUseId}.txt`);
        const fullPath = `${sessionDir}/${TOOL_RESULT_DIR}/${fileName}`;
        FileUtils.writeFile(fullPath, output);
        output = output.slice(0, PREVIEW_CHAR_LENGTH);
        return `<persisted-output>
Full output saved to: ${fullPath}
Preview:
${output}
</persisted-output>`;
    }
}
