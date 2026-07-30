import {beforeEach, describe, expect, test, vi} from 'vitest';
import {newTestContext} from '../../../test-support/one-loop-context';
import {HookManager} from '../services/hook-manager';
import './hooks';

const mocks = vi.hoisted(() => ({
    drainFinishedCommands: vi.fn<() => unknown[]>(() => []),
}));

vi.mock('../services/background-command-manager', () => ({
    BackgroundCommandManager: {drainFinishedCommands: mocks.drainFinishedCommands},
}));

describe('foot print hook', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.drainFinishedCommands.mockReturnValue([]);
    });

    test('records every tool use with its input', async () => {
        const context = newTestContext();
        await HookManager.emitVisitor('preEachToolUse', context, {
            id: 'tu1', name: 'read_file', input: {filePath: 'a.md'}
        });
        expect(context.actions.addFootPrint).toHaveBeenCalledExactlyOnceWith({
            type: 'toolUse',
            content: 'read_file with input {"filePath":"a.md"}',
        });
    });
});

describe('log hook', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.drainFinishedCommands.mockReturnValue([]);
    });

    test('announces the start of the loop', async () => {
        const context = newTestContext();
        await HookManager.emitVisitor('preLoopStart', context);
        expect(context.logger.info).toHaveBeenCalledWith('Starting loop');
    });

    test('counts the turn that is about to run', async () => {
        const context = newTestContext();
        context.runtime.turnCount = 2;
        await HookManager.emitVisitor('preTurnStart', context);
        expect(context.logger.info).toHaveBeenCalledWith('Starting turn 3');
    });
});

describe('background command hook', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.drainFinishedCommands.mockReturnValue([]);
    });

    test('tells the agent about the commands that finished meanwhile', async () => {
        mocks.drainFinishedCommands.mockReturnValue([{id: 'c1', output: 'done'}]);
        const context = newTestContext();
        await HookManager.emitVisitor('preTurnStart', context);
        expect(context.actions.addStringMessage).toHaveBeenCalledExactlyOnceWith(
            '1 background commands finished: \n[{"id":"c1","output":"done"}]'
        );
    });

    test('stays quiet when no command finished', async () => {
        const context = newTestContext();
        await HookManager.emitVisitor('preTurnStart', context);
        expect(context.actions.addStringMessage).not.toHaveBeenCalled();
    });

    test('drains the finished commands only once per turn', async () => {
        await HookManager.emitVisitor('preTurnStart', newTestContext());
        expect(mocks.drainFinishedCommands).toHaveBeenCalledOnce();
    });
});

describe('history hook', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.drainFinishedCommands.mockReturnValue([]);
    });

    test('rewrites the whole history after the tool results were compacted', async () => {
        const context = newTestContext();
        context.runtime.historyPersistIndex = 12;
        await HookManager.emitVisitor('toolResultCompacted', context, 3);
        expect(context.runtime.historyPersistIndex).toBe(0);
    });

    test('rewrites the whole history after the history was compacted', async () => {
        const context = newTestContext();
        context.runtime.historyPersistIndex = 12;
        await HookManager.emitVisitor('historyCompacted', context, 3);
        expect(context.runtime.historyPersistIndex).toBe(0);
    });
});
