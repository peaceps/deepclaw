import type { OneLoopContext } from '../../definitions/definitions';
import type { ToolUseDef } from './tool-use-service';

type Hook = InterceptorHook | VisitorHook;
type InterceptorHook = 'preEachToolUse';
type VisitorHook =
    'preLoopStart' |
    'postLoopEnd' |
    'preTurnStart' |
    'turnError' |
    'postTurnEnd' |
    'preEachToolUse' |
    'postEachToolUse';

type InterceptorResult = {
    result: 'continue' | 'stop';
    stopReason?: string;
};

type InterceptorHookFunction = (oneLoopContext: OneLoopContext, toolUseDef?: ToolUseDef) => Promise<string> | string;
type VisitorHookFunction = (oneLoopContext: OneLoopContext, toolUseDef?: ToolUseDef) => Promise<void> | void;
type HookFunction = InterceptorHookFunction | VisitorHookFunction;

export class HookManager {

    private static interceptorHooks: Map<InterceptorHook, InterceptorHookFunction[]> = new Map();
    private static visitorHooks: Map<VisitorHook, VisitorHookFunction[]> = new Map();

    public static onInterceptor(hook: InterceptorHook, callback: InterceptorHookFunction): void {
        this.on(this.interceptorHooks, hook, callback);
    }

    public static onVisitor(hook: VisitorHook, callback: VisitorHookFunction): void {
        this.on(this.visitorHooks, hook, callback);
    }

    private static on<H extends Hook, F extends HookFunction>(hooks: Map<H, F[]>, hook: H, callback: F): void {
        if (!hooks.has(hook)) {
            hooks.set(hook, []);
        }
        hooks.get(hook)!.push(callback);
    }

    public static async emitVisitor(hook: VisitorHook, oneLoopContext: OneLoopContext, toolUseDef?: ToolUseDef): Promise<void> {
        for (const hookFunction of this.visitorHooks.get(hook) ?? []) {
            await hookFunction(oneLoopContext, toolUseDef);
        }
    }

    public static async emitInterceptor(
        hook: InterceptorHook,
        oneLoopContext: OneLoopContext,
        toolUseDef?: ToolUseDef
    ): Promise<InterceptorResult> {
        for (const hookFunction of this.interceptorHooks.get(hook) ?? []) {
            try {
                const result = await hookFunction(oneLoopContext, toolUseDef);
                if (result) {
                    return {result: 'stop', stopReason: result};
                }
            } catch (error) {
                oneLoopContext.logger.error(error, `Error in hook ${hook}, ${error instanceof Error ? error.message : 'Unknown error.'}`);
            }
        }
        return { result: 'continue' };
    }

}