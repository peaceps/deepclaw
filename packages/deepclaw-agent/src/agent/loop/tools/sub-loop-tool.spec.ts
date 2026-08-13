import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type FlushAgent, type TokenUsage} from '@deepclaw/core';
import {newTestContext, newTestRuntime} from '../../../test-support/one-loop-context';
import {type OneLoopContext} from '../../definitions/definitions';
import {subLoopTool} from './sub-loop-tool';

const mocks = vi.hoisted(() => ({
    deleteDir: vi.fn<(dir: string) => void>(() => undefined),
    dropSession: vi.fn<(dir: string) => void>(() => undefined),
    getTask: vi.fn<(projectId: string, taskTitle: string) => unknown>(() => todoTask()),
    updateTask: vi.fn<(projectId: string, task: unknown) => void>(() => undefined),
    fireProjectInfoEvent: vi.fn<(projectId: string, context: unknown) => void>(() => undefined),
    startRun: vi.fn<(run: unknown) => string>(() => 'run1'),
    finishRun: vi.fn<(runId: string) => void>(),
    getRunningTasks: vi.fn<() => unknown[]>(() => []),
    isRunning: vi.fn<(projectId: string, taskTitle: string) => boolean>(() => false),
}));

function todoTask(status = 'todo') {
    return {title: 'ship it', status};
}

vi.mock('../services/project-manager', () => ({ProjectManager: {
    getTask: mocks.getTask,
    updateTask: mocks.updateTask,
    fireProjectInfoEvent: mocks.fireProjectInfoEvent,
}}));

vi.mock('../services/running-task-service', () => ({
    RunningTaskService: {
        start: mocks.startRun, finish: mocks.finishRun, getRunningTasks: mocks.getRunningTasks,
        isRunning: mocks.isRunning,
    },
}));

vi.mock('@deepclaw/i18n', () => ({
    i18nInstance: {
        t: (key: string, params?: Record<string, string>) =>
            params ? `${key} ${JSON.stringify(params)}` : key,
    },
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
        getDrawnImages: vi.fn<() => string[]>(() => []),
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
        mocks.getTask.mockReturnValue(todoTask());
        mocks.isRunning.mockReturnValue(false);
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

    /** The reference is the only handle on the bytes, and the summary of a sub loop may drop it. */
    test('names the pictures the sub loop drew next to what it wrote', async () => {
        const subLoop = newSubLoop('drew the poster');
        subLoop.getDrawnImages.mockReturnValue(['dcimg://agent.a1/aa.png', 'dcimg://agent.a1/bb.png']);
        const result = await subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(subLoop));
        expect(result).toContain('drew the poster');
        expect(result).toContain('![image](dcimg://agent.a1/aa.png)');
        expect(result).toContain('![image](dcimg://agent.a1/bb.png)');
    });

    test('leaves the text alone when the sub loop drew nothing', async () => {
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

    test('spawns a plain sub loop when no task was named', async () => {
        const subLoop = newSubLoop();
        const context = contextWithSubLoop(subLoop);
        await subLoopTool.invoke({prompt: 'go'}, context);
        expect(context.actions.newSubLoop).toHaveBeenCalledExactlyOnceWith(undefined);
        expect(mocks.getTask).not.toHaveBeenCalled();
    });

    test('hands the named task of the current project to the sub loop', async () => {
        const subLoop = newSubLoop();
        const context = contextWithSubLoop(subLoop);
        context.projectId = 'p1';
        await subLoopTool.invoke({prompt: 'go', taskTitle: 'ship it'}, context);
        expect(context.actions.newSubLoop)
            .toHaveBeenCalledExactlyOnceWith({projectId: 'p1', taskTitle: 'ship it'});
    });

    /** A sub loop may only move the step index, and that is refused while the task is todo. */
    test('marks the task ongoing as it hands it over', async () => {
        const context = contextWithSubLoop(newSubLoop());
        context.projectId = 'p1';
        await subLoopTool.invoke({prompt: 'go', taskTitle: 'ship it'}, context);
        expect(mocks.updateTask).toHaveBeenCalledExactlyOnceWith('p1', {title: 'ship it', status: 'ongoing'});
        expect(mocks.fireProjectInfoEvent).toHaveBeenCalledExactlyOnceWith('p1', context);
    });

    test('leaves a task that is already ongoing where it is', async () => {
        mocks.getTask.mockReturnValue(todoTask('ongoing'));
        const context = contextWithSubLoop(newSubLoop());
        context.projectId = 'p1';
        await subLoopTool.invoke({prompt: 'go', taskTitle: 'ship it'}, context);
        expect(mocks.updateTask).not.toHaveBeenCalled();
        expect(context.actions.newSubLoop)
            .toHaveBeenCalledExactlyOnceWith({projectId: 'p1', taskTitle: 'ship it'});
    });

    /** The status of a done task cannot go back, so a sub loop could not report on it either. */
    test('refuses a task that is already done', async () => {
        mocks.getTask.mockReturnValue(todoTask('done'));
        const context = contextWithSubLoop(newSubLoop());
        context.projectId = 'p1';
        await expect(subLoopTool.invoke({prompt: 'go', taskTitle: 'ship it'}, context))
            .rejects.toThrow('Task "ship it" is done');
        expect(context.actions.newSubLoop).not.toHaveBeenCalled();
    });

    /** Two subagents on one task would work over each other in the same files. */
    test('refuses a task another subagent is on already', async () => {
        mocks.isRunning.mockReturnValue(true);
        const context = contextWithSubLoop(newSubLoop());
        context.projectId = 'p1';
        await expect(subLoopTool.invoke({prompt: 'go', taskTitle: 'ship it'}, context))
            .rejects.toThrow('A subagent is working on "ship it" already');
        expect(mocks.isRunning).toHaveBeenCalledWith('p1', 'ship it');
        expect(mocks.updateTask).not.toHaveBeenCalled();
        expect(context.actions.newSubLoop).not.toHaveBeenCalled();
    });

    /** The project id of a cron loop names its cron task, no project task can be found under it. */
    test('refuses to hand a task over from a cron run', async () => {
        const context = contextWithSubLoop(newSubLoop());
        context.role = 'cron';
        context.projectId = 'c1';
        await expect(subLoopTool.invoke({prompt: 'go', taskTitle: 'ship it'}, context))
            .rejects.toThrow('A cron run has no project to take a task from');
        expect(mocks.getTask).not.toHaveBeenCalled();
    });

    test('still spawns a plain sub loop from a cron run', async () => {
        const context = contextWithSubLoop(newSubLoop());
        context.role = 'cron';
        context.projectId = 'c1';
        await expect(subLoopTool.invoke({prompt: 'go'}, context)).resolves.toBe('sub loop answer');
    });

    /** A task of another project would be worked on with the memory and skills of this one. */
    test('refuses to hand a task over from a session without a project', async () => {
        const context = contextWithSubLoop(newSubLoop());
        context.projectId = '';
        await expect(subLoopTool.invoke({prompt: 'go', taskTitle: 'ship it'}, context))
            .rejects.toThrow('This session runs no project');
        expect(mocks.getTask).not.toHaveBeenCalled();
        expect(context.actions.newSubLoop).not.toHaveBeenCalled();
    });

    test('refuses a task that the project does not have', async () => {
        mocks.getTask.mockReturnValue(undefined);
        const context = contextWithSubLoop(newSubLoop());
        context.projectId = 'p1';
        await expect(subLoopTool.invoke({prompt: 'go', taskTitle: 'ghost'}, context))
            .rejects.toThrow('Task "ghost" not found in project "p1".');
        expect(context.actions.newSubLoop).not.toHaveBeenCalled();
    });

    test('registers the run while the task sub loop works and retires it after', async () => {
        const subLoop = newSubLoop();
        const context = contextWithSubLoop(subLoop);
        context.projectId = 'p1';
        mocks.getTask.mockReturnValue({title: 'ship it', assignee: 'a2'});
        subLoop.invoke.mockImplementation(async () => {
            expect(mocks.startRun).toHaveBeenCalledExactlyOnceWith({
                projectId: 'p1', taskTitle: 'ship it', agentId: 'a2', startedAt: expect.any(String),
            });
            expect(mocks.finishRun).not.toHaveBeenCalled();
            return {text: 'done', runtime: newTestRuntime()};
        });

        await subLoopTool.invoke({prompt: 'go', taskTitle: 'ship it'}, context);

        expect(mocks.finishRun).toHaveBeenCalledExactlyOnceWith('run1');
    });

    /** Whoever spawned the sub loop owns the run when the task names nobody to work on it. */
    test('files a run of an unassigned task under the agent that spawned it', async () => {
        const context = contextWithSubLoop(newSubLoop());
        context.projectId = 'p1';
        mocks.getTask.mockReturnValue({title: 'ship it'});
        await subLoopTool.invoke({prompt: 'go', taskTitle: 'ship it'}, context);
        expect(mocks.startRun).toHaveBeenCalledWith(expect.objectContaining({agentId: 'a1'}));
    });

    test('retires the run even when the sub loop throws', async () => {
        const subLoop = newSubLoop();
        subLoop.invoke.mockRejectedValue(new Error('sub loop crashed'));
        const context = contextWithSubLoop(subLoop);
        context.projectId = 'p1';
        await expect(subLoopTool.invoke({prompt: 'go', taskTitle: 'ship it'}, context))
            .rejects.toThrow('sub loop crashed');
        expect(mocks.finishRun).toHaveBeenCalledExactlyOnceWith('run1');
    });

    test('registers nothing for a sub loop that works on no task', async () => {
        await subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(newSubLoop()));
        expect(mocks.startRun).not.toHaveBeenCalled();
        expect(mocks.finishRun).not.toHaveBeenCalled();
    });

    test('tells the browsers about the runs when one starts and when it ends', async () => {
        const context = contextWithSubLoop(newSubLoop());
        context.projectId = 'p1';
        mocks.getRunningTasks.mockReturnValueOnce([{taskTitle: 'ship it'}]).mockReturnValueOnce([]);

        await subLoopTool.invoke({prompt: 'go', taskTitle: 'ship it'}, context);

        expect(context.actions.agentHandler.onInfoEvent).toHaveBeenNthCalledWith(1, {
            eventType: 'updateRunningTasks', content: [{taskTitle: 'ship it'}],
        });
        expect(context.actions.agentHandler.onInfoEvent).toHaveBeenNthCalledWith(2, {
            eventType: 'updateRunningTasks', content: [],
        });
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
