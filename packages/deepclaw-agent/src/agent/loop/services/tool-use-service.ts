import { FileUtils } from '@deepclaw/node-utils';
import { ToolUseResult, ToolUseDef, ToolDesc } from "../../definitions/tool-definitions";
import { isSpawnedLoop, OneLoopContext } from '../../definitions/definitions';
import { TOOL_RESULT_DIR } from '../../paths';
import { TRUNCATE_THRESHOLD } from '../../loop-utils';
import { ToolsManager } from './tools-manager';
import { HookManager } from './hook-manager';
import { isInternalInterruptReason } from '@deepclaw/core';

export type ToolUseServiceResult = {
    result: ToolUseResult;
    success: boolean;
    rerun?: boolean;
}

/** What a guard that had to ask ends up with, once the user answered or the guard changed its mind. */
type GuardVerdict = {answer: 'allowed' | 'rejected'} | {answer: 'denied', reason: string};

const PREVIEW_CHAR_LENGTH = 1000;
const MAX_PARALLEL_TOOL_CALLS = 5;

export class ToolUseService {

    private static questionQueues: Map<string, Promise<unknown>> = new Map();

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
        for (const toolUseDef of toolUseDefs) {
            const tool = ToolsManager.getToolDesc(context.loopKind, context.loopConfig.mode, toolUseDef.name);
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
        const tool = ToolsManager.getToolDesc(context.loopKind, context.loopConfig.mode, toolUseDef.name);
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
        // Nobody is there to answer inside a spawned loop, so the tool goes through on the trust the
        // subagent was handed with the task: a denial only made it report the question back. Several
        // of them run at once, and a question each would be a queue nobody asked the user for.
        if (isSpawnedLoop(context.loopKind)) {
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
            if (isInternalInterruptReason(error)) {
                context.runtime.agentBreakReason = error;
                return {
                    ...this.toolResult(toolUseDef.id, `User left page and not possible to interact. Need rerun this tool`, false),
                    rerun: true,
                };
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
            // The user was already found to be away while this question waited its turn. Asking
            // anyway would only sit there until the interaction times out, once per queued tool.
            const away = context.runtime.agentBreakReason;
            if (isInternalInterruptReason(away)) {
                throw away;
            }
            const choice = await context.actions.agentHandler.onInteractionEvent(
                { ...guardResult.question, browserId: context.browserId }
            );
            return {answer: guardResult.checkAnswer(choice) ? 'allowed' : 'rejected'};
        });
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
