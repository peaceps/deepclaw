import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type FlushAgent, type TokenUsage} from '@deepclaw/core';
import {newTestContext, newTestRuntime} from '../../../test-support/one-loop-context';
import {type OneLoopContext} from '../../definitions/definitions';
import {subLoopTool} from './sub-loop-tool';

const mocks = vi.hoisted(() => ({
    deleteDir: vi.fn<(dir: string) => void>(() => undefined),
    dropSession: vi.fn<(dir: string) => void>(() => undefined),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {deleteDir: mocks.deleteDir},
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

vi.mock('../services/session-service', () => ({SessionService: {dropSession: mocks.dropSession}}));

function newSubLoop(text = 'sub loop answer', usage: TokenUsage = newTestRuntime().usage) {
    return {
        invoke: vi.fn(async () => ({text, runtime: newTestRuntime({usage})})),
        getSessionDir: vi.fn(() => '.agents/a1/session/sub9'),
    };
}

function contextWithSubLoop(subLoop: ReturnType<typeof newSubLoop>): OneLoopContext {
    const context = newTestContext();
    vi.mocked(context.actions.newSubLoop).mockReturnValue(subLoop as unknown as FlushAgent);
    return context;
}

describe('subLoopTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('runs the prompt on a freshly spawned sub loop', async () => {
        const subLoop = newSubLoop();
        const context = contextWithSubLoop(subLoop);
        await subLoopTool.invoke({prompt: 'summarise the repo'}, context);
        expect(context.actions.newSubLoop).toHaveBeenCalledOnce();
        expect(subLoop.invoke).toHaveBeenCalledExactlyOnceWith('summarise the repo', {browserId: 'b1'});
    });

    test('returns the text the sub loop produced', async () => {
        const result = await subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(newSubLoop('done')));
        expect(result).toBe('done');
    });

    test('cleans up the sub loop session directory once it finished', async () => {
        const subLoop = newSubLoop();
        await subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(subLoop));
        expect(mocks.deleteDir).toHaveBeenCalledExactlyOnceWith('.agents/a1/session/sub9');
    });

    test('cleans up the session directory even when the sub loop throws', async () => {
        const subLoop = newSubLoop();
        subLoop.invoke.mockRejectedValue(new Error('sub loop crashed'));
        await expect(subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(subLoop)))
            .rejects.toThrow('sub loop crashed');
        expect(mocks.deleteDir).toHaveBeenCalledExactlyOnceWith('.agents/a1/session/sub9');
    });

    test('forgets the session metadata of the sub loop as well', async () => {
        const subLoop = newSubLoop();
        await subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(subLoop));
        expect(mocks.dropSession).toHaveBeenCalledExactlyOnceWith('.agents/a1/session/sub9');
    });

    test('bills the tokens the sub loop spent to its parent', async () => {
        const subLoop = newSubLoop('done', {
            cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3,
        });
        const context = contextWithSubLoop(subLoop);
        context.runtime.usage = {cachedInputTokens: 10, noCachedInputTokens: 20, outputTokens: 30};
        await subLoopTool.invoke({prompt: 'go'}, context);
        expect(context.runtime.usage).toEqual({
            cachedInputTokens: 11, noCachedInputTokens: 22, outputTokens: 33,
        });
    });
});

describe('subLoopTool metadata', () => {

    test('is parallel safe but never offered inside a sub loop', () => {
        expect(subLoopTool.parallelSafe).toBe(true);
        expect(subLoopTool.exclusiveInSubLoop).toBe(true);
        expect(subLoopTool.agentMode).toEqual(['agent']);
    });
});
