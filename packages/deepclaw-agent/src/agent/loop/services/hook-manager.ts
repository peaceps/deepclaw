import type { OneLoopContext } from '../../definitions/definitions';
import type { ToolUseDef } from '../../definitions/tool-definitions';
import type { ToolUseServiceResult } from './tool-use-service';

type InterceptorResult = {
    result: 'continue' | 'stop';
    stopReason?: string;
};

type InterceptorHook = 'preEachToolUse';
type VisitorHook =
    'preLoopStart' |
    'postLoopEnd' |
    'preTurnStart' |
    'turnError' |
    'postTurnEnd' |
    'preEachToolUse' |
    'toolGuardDenied' |
    'toolResultCompacted' |
    'historyCompacted' |
    'postEachToolUse';
type Hook = InterceptorHook | VisitorHook;

type HookContent = {
    preLoopStart: void;
    postLoopEnd: void;
    preTurnStart: void;
    turnError: void;
    postTurnEnd: void;
    preEachToolUse: ToolUseDef;
    postEachToolUse: { toolUseDef: ToolUseDef; result: ToolUseServiceResult };
    toolGuardDenied: { toolUseDef: ToolUseDef; reason: string };
    toolResultCompacted: number;
    historyCompacted: number;
};
type HookContentMap = { [K in Hook]: HookContent[K] };

type InterceptorHookFunction<H extends InterceptorHook> =
    (oneLoopContext: OneLoopContext, content: HookContentMap[H]) => Promise<string> | string;
type VisitorHookFunction<H extends VisitorHook> =
    (oneLoopContext: OneLoopContext, content: HookContentMap[H]) => Promise<void> | void;

export class HookManager {

    private static interceptorHooks: Map<InterceptorHook, InterceptorHookFunction<InterceptorHook>[]> = new Map();
    private static visitorHooks: Map<VisitorHook, VisitorHookFunction<VisitorHook>[]> = new Map();

    public static onInterceptor<H extends InterceptorHook>(
        hook: H, callback: InterceptorHookFunction<H>
    ): void {
        this.on(this.interceptorHooks, hook, callback as InterceptorHookFunction<InterceptorHook>);
    }

    public static onVisitor<H extends VisitorHook>(
        hook: H, callback: VisitorHookFunction<H>
    ): void {
        this.on(this.visitorHooks, hook, callback as VisitorHookFunction<VisitorHook>);
    }

    private static on<H extends Hook, F>(
        hooks: Map<H, F[]>, hook: H, callback: F
    ): void {
        if (!hooks.has(hook)) {
            hooks.set(hook, []);
        }
        hooks.get(hook)!.push(callback);
    }

    public static async emitVisitor<H extends VisitorHook>(
        hook: H, oneLoopContext: OneLoopContext, content?: HookContentMap[H]
    ): Promise<void> {
        for (const hookFunction of this.visitorHooks.get(hook) ?? []) {
            await (hookFunction as VisitorHookFunction<H>)(oneLoopContext, content as HookContentMap[H]);
        }
    }

    public static async emitInterceptor<H extends InterceptorHook>(
        hook: H, oneLoopContext: OneLoopContext, content: HookContentMap[H]
    ): Promise<InterceptorResult> {
        for (const hookFunction of this.interceptorHooks.get(hook) ?? []) {
            try {
                const result = await (hookFunction as InterceptorHookFunction<H>)(oneLoopContext, content);
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
