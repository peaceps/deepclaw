import {beforeEach, describe, expect, test, vi} from 'vitest';
import {newTestContext} from '../../../test-support/one-loop-context';

/** Hooks are kept in static maps, so each test starts from a freshly loaded module. */
async function newHookManager() {
    vi.resetModules();
    return (await import('./hook-manager')).HookManager;
}

describe('emitVisitor', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('does nothing when nobody listens', async () => {
        const HookManager = await newHookManager();
        await expect(HookManager.emitVisitor('preLoopStart', newTestContext())).resolves.toBeUndefined();
    });

    test('hands the context and the content to the listener', async () => {
        const HookManager = await newHookManager();
        const listener = vi.fn();
        const context = newTestContext();
        HookManager.onVisitor('toolResultCompacted', listener);
        await HookManager.emitVisitor('toolResultCompacted', context, 42);
        expect(listener).toHaveBeenCalledExactlyOnceWith(context, 42);
    });

    test('leaves the content undefined when the hook carries none', async () => {
        const HookManager = await newHookManager();
        const listener = vi.fn();
        HookManager.onVisitor('preTurnStart', listener);
        await HookManager.emitVisitor('preTurnStart', newTestContext());
        expect(listener).toHaveBeenCalledWith(expect.anything(), undefined);
    });

    test('runs the listeners in registration order and waits for each one', async () => {
        const HookManager = await newHookManager();
        const order: string[] = [];
        HookManager.onVisitor('postTurnEnd', async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            order.push('slow');
        });
        HookManager.onVisitor('postTurnEnd', () => {
            order.push('fast');
        });
        await HookManager.emitVisitor('postTurnEnd', newTestContext());
        expect(order).toEqual(['slow', 'fast']);
    });

    test('only notifies the listeners of the emitted hook', async () => {
        const HookManager = await newHookManager();
        const other = vi.fn();
        HookManager.onVisitor('postLoopEnd', other);
        await HookManager.emitVisitor('preLoopStart', newTestContext());
        expect(other).not.toHaveBeenCalled();
    });

    /**
     * A hook is an extension, and one written badly must not take the run down with it. Two of
     * these fire from inside a tool group, where a throw discards the results of every group that
     * already finished and leaves the turn owing an answer to calls the model asked for.
     */
    test('logs a failing listener and keeps going, as the interceptors already did', async () => {
        const HookManager = await newHookManager();
        const context = newTestContext();
        const later = vi.fn();
        HookManager.onVisitor('postEachToolUse', () => {
            throw new Error('hook exploded');
        });
        HookManager.onVisitor('postEachToolUse', later);
        await expect(HookManager.emitVisitor('postEachToolUse', context, {
            toolUseDef: {id: 'tu1', name: 'demo', input: {}},
            result: {result: {id: 'tu1', content: 'done'}, success: true},
        })).resolves.toBeUndefined();
        expect(context.logger.error).toHaveBeenCalled();
        expect(later).toHaveBeenCalled();
    });

    test('survives a listener whose promise rejects, not only one that throws outright', async () => {
        const HookManager = await newHookManager();
        const context = newTestContext();
        HookManager.onVisitor('preTurnStart', async () => {
            throw new Error('hook exploded later');
        });
        await expect(HookManager.emitVisitor('preTurnStart', context)).resolves.toBeUndefined();
        expect(context.logger.error).toHaveBeenCalled();
    });

    test('does not reach the interceptors registered under the same name', async () => {
        const HookManager = await newHookManager();
        const interceptor = vi.fn(() => '');
        HookManager.onInterceptor('preEachToolUse', interceptor);
        await HookManager.emitVisitor('preEachToolUse', newTestContext(), {
            id: 'tu1', name: 'demo', input: {}
        });
        expect(interceptor).not.toHaveBeenCalled();
    });
});

describe('emitInterceptor', () => {
    const toolUseDef = {id: 'tu1', name: 'demo', input: {}};

    test('continues when nobody listens', async () => {
        const HookManager = await newHookManager();
        await expect(HookManager.emitInterceptor('preEachToolUse', newTestContext(), toolUseDef))
            .resolves.toEqual({result: 'continue'});
    });

    test('continues while the listeners return nothing', async () => {
        const HookManager = await newHookManager();
        HookManager.onInterceptor('preEachToolUse', () => '');
        HookManager.onInterceptor('preEachToolUse', async () => '');
        await expect(HookManager.emitInterceptor('preEachToolUse', newTestContext(), toolUseDef))
            .resolves.toEqual({result: 'continue'});
    });

    test('stops at the first listener that returns a reason', async () => {
        const HookManager = await newHookManager();
        const later = vi.fn(() => 'never reached');
        HookManager.onInterceptor('preEachToolUse', () => 'command is blocked');
        HookManager.onInterceptor('preEachToolUse', later);
        const result = await HookManager.emitInterceptor('preEachToolUse', newTestContext(), toolUseDef);
        expect(result).toEqual({result: 'stop', stopReason: 'command is blocked'});
        expect(later).not.toHaveBeenCalled();
    });

    test('logs a failing listener and keeps going', async () => {
        const HookManager = await newHookManager();
        const context = newTestContext();
        HookManager.onInterceptor('preEachToolUse', () => {
            throw new Error('hook exploded');
        });
        const later = vi.fn(() => '');
        HookManager.onInterceptor('preEachToolUse', later);
        const result = await HookManager.emitInterceptor('preEachToolUse', context, toolUseDef);
        expect(context.logger.error).toHaveBeenCalled();
        expect(later).toHaveBeenCalled();
        expect(result).toEqual({result: 'continue'});
    });

    test('hands the tool use to the listener', async () => {
        const HookManager = await newHookManager();
        const listener = vi.fn(() => '');
        const context = newTestContext();
        HookManager.onInterceptor('preEachToolUse', listener);
        await HookManager.emitInterceptor('preEachToolUse', context, toolUseDef);
        expect(listener).toHaveBeenCalledExactlyOnceWith(context, toolUseDef);
    });
});
