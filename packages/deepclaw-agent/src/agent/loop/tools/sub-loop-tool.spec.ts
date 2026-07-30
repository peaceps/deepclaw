import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type FlushAgent} from '@deepclaw/core';
import {newTestContext} from '../../../test-support/one-loop-context';
import {type OneLoopContext} from '../../definitions/definitions';
import {subLoopTool} from './sub-loop-tool';

const mocks = vi.hoisted(() => ({
    deleteDir: vi.fn<(dir: string) => void>(() => undefined),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {deleteDir: mocks.deleteDir},
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

function newSubLoop(text = 'sub loop answer') {
    return {
        invoke: vi.fn(async () => ({text})),
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
});

describe('subLoopTool metadata', () => {

    test('is parallel safe but never offered inside a sub loop', () => {
        expect(subLoopTool.parallelSafe).toBe(true);
        expect(subLoopTool.exclusiveInSubLoop).toBe(true);
        expect(subLoopTool.agentMode).toEqual(['agent']);
    });
});
