import { HookManager } from '@deepclaw/agent';
import type { ToolCallTrace } from './trace';

export type HookTrace = {
    toolCalls: ToolCallTrace[];
    guardDenied: {name: string, reason: string}[];
    compactions: {toolResults: number, history: number};
    interrupts: string[];
    turns: number;
    /** One entry per turn, covering compaction, the model call and the tools of that turn. */
    turnMs: number[];
};

/**
 * Everything the loop does to itself, observed from the hook bus: which tools ran and for how
 * long, what a guard refused, when history had to be squeezed, and why a turn was cut short.
 * The hooks are global and this runs one case per process, so no unregistering is needed.
 */
export function installTraceHooks(maxTurns?: number): HookTrace {
    const trace: HookTrace = {
        toolCalls: [],
        guardDenied: [],
        compactions: {toolResults: 0, history: 0},
        interrupts: [],
        turns: 0,
        turnMs: [],
    };
    const startedAt = new Map<string, number>();
    let turnStartedAt = 0;

    HookManager.onVisitor('preTurnStart', () => {
        trace.turns++;
        turnStartedAt = Date.now();
    });
    HookManager.onVisitor('postTurnEnd', () => {
        trace.turnMs.push(turnStartedAt ? Date.now() - turnStartedAt : 0);
    });
    HookManager.onVisitor('preEachToolUse', (_context, toolUseDef) => {
        startedAt.set(toolUseDef.id, Date.now());
    });
    HookManager.onVisitor('postEachToolUse', (_context, {toolUseDef, result}) => {
        const started = startedAt.get(toolUseDef.id);
        trace.toolCalls.push({
            name: toolUseDef.name,
            input: toolUseDef.input,
            ok: result.success,
            ms: started ? Date.now() - started : 0,
        });
    });
    HookManager.onVisitor('toolGuardDenied', (_context, {toolUseDef, reason}) => {
        trace.guardDenied.push({name: toolUseDef.name, reason});
    });
    HookManager.onVisitor('toolResultCompacted', () => {
        trace.compactions.toolResults++;
    });
    HookManager.onVisitor('historyCompacted', () => {
        trace.compactions.history++;
    });
    HookManager.onVisitor('externalInterrupt', (_context, reason) => {
        trace.interrupts.push(`external:${reason}`);
    });
    HookManager.onVisitor('internalInterrupt', (_context, reason) => {
        trace.interrupts.push(`internal:${reason}`);
    });

    if (maxTurns) {
        // A runaway loop would otherwise burn the whole timeout, so the turn budget is
        // enforced from the inside and the run still ends with a readable trace.
        HookManager.onInterceptor('preEachToolUse', () =>
            trace.turns > maxTurns ? `eval: turn budget of ${maxTurns} exceeded` : ''
        );
    }
    return trace;
}
