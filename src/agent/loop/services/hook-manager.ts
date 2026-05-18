import type { OneLoopContext } from '../../definitions/definitions.js';

export type HookType =
    'preLoopStart' |
    'postLoopStart' |
    'preTurnStart' |
    'postTurnStart' |
    'preEachToolUse' |
    'postEachToolUse' |
    'preAllToolUse' |
    'postAllToolUse' |
    'preTurnEnd' |
    'postTurnEnd' |
    'preLoopEnd' |
    'postLoopEnd';

export type InterceptorResult = {
    result: 'continue' | 'stop';
    reason?: string;
};

type HookFunction = (oneLoopContext: OneLoopContext) => Promise<InterceptorResult | void> | void;

export class HookManager {

    private static hooks: Map<HookType, HookFunction[]> = new Map();

    public static on(hook: HookType, hookFunction: HookFunction): void {
        if (!this.hooks.has(hook)) {
            this.hooks.set(hook, []);
        }
        this.hooks.get(hook)!.push(hookFunction);
    }

    public static async emit(hook: HookType, oneLoopContext: OneLoopContext): Promise<InterceptorResult | void> {
        const hookFunctions = this.hooks.get(hook);
        if (hookFunctions) {
            for (const hookFunction of hookFunctions) {
                return await hookFunction(oneLoopContext);
            }
        }
    }

}