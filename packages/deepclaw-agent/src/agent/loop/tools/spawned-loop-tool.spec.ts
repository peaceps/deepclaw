import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type FlushAgent, type TokenUsage} from '@deepclaw/core';
import {newTestContext, newTestRuntime} from '../../../test-support/one-loop-context';
import {type OneLoopContext} from '../../definitions/definitions';
import {subLoopTool, taskLoopTool} from './spawned-loop-tool';

const mocks = vi.hoisted(() => ({
    deleteDir: vi.fn<(dir: string) => void>(() => undefined),
    dropSession: vi.fn<(dir: string) => void>(() => undefined),
    getTask: vi.fn<(projectId: string, taskId: string) => unknown>(() => todoTask()),
    getProjectDetail: vi.fn<(projectId: string) => unknown>(() => startedProject()),
    updateTask: vi.fn<(projectId: string, task: unknown) => void>(() => undefined),
    fireProjectInfoEvent: vi.fn<(projectId: string, context: unknown) => void>(() => undefined),
    startRun: vi.fn<(run: unknown) => string>(() => 'run1'),
    finishRun: vi.fn<(runId: string) => void>(),
    getRunningTasks: vi.fn<() => unknown[]>(() => []),
    isRunning: vi.fn<(projectId: string, taskId: string) => boolean>(() => false),
}));

function todoTask(status = 'todo') {
    return {id: 'ship-it', title: 'ship it', status};
}

/** As it stands whenever a task of it is handed out: the user has set the work going. */
function startedProject(overrides: Record<string, unknown> = {}) {
    return {
        id: 'p1', startedAt: '2026-01-01T00:00:00.000Z',
        ongoingTasks: [], completedTasks: [], ...overrides,
    };
}

vi.mock('../services/project-manager', () => ({ProjectManager: {
    getTask: mocks.getTask,
    getProjectDetail: mocks.getProjectDetail,
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

const SESSION_DIR = '/tmp/.deepclaw/subloop/sub9';

function newSpawnedLoop(text = 'spawned loop answer', usage: TokenUsage = newTestRuntime().usage) {
    return {
        invoke: vi.fn(async () => ({text, runtime: newTestRuntime({usage})})),
        getSessionDir: vi.fn(() => SESSION_DIR),
        getDrawnImages: vi.fn<() => string[]>(() => []),
    };
}

type SpawnedLoopMock = ReturnType<typeof newSpawnedLoop>;

/** A loop that is still being built, so a test can stand in the middle of that await. */
function pending<T>(): {promise: Promise<T>, settle: (value: T) => void} {
    let settle!: (value: T) => void;
    const promise = new Promise<T>(resolve => {settle = resolve;});
    return {promise, settle};
}

/** The tool goes to a project run and to no other, so that is the run these are called under. */
function contextWithTaskLoop(taskLoop: SpawnedLoopMock, projectId = 'p1'): OneLoopContext {
    const context = newTestContext({projectId, role: 'project'});
    vi.mocked(context.actions.newTaskLoop).mockResolvedValue(taskLoop as unknown as FlushAgent);
    return context;
}

function contextWithSubLoop(subLoop: SpawnedLoopMock): OneLoopContext {
    const context = newTestContext();
    vi.mocked(context.actions.newSubLoop).mockReturnValue(subLoop as unknown as FlushAgent);
    return context;
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTask.mockReturnValue(todoTask());
    mocks.getProjectDetail.mockReturnValue(startedProject());
    mocks.isRunning.mockReturnValue(false);
    mocks.startRun.mockReturnValue('run1');
});

describe('taskLoopTool invoke', () => {

    test('hands the named task of the current project to a task loop', async () => {
        const taskLoop = newSpawnedLoop();
        const context = contextWithTaskLoop(taskLoop);
        await taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context);
        expect(context.actions.newTaskLoop)
            .toHaveBeenCalledExactlyOnceWith({projectId: 'p1', taskId: 'ship-it'});
        expect(taskLoop.invoke).toHaveBeenCalledExactlyOnceWith('go', {browserId: 'b1'});
    });

    test('returns the text the task loop produced', async () => {
        const context = contextWithTaskLoop(newSpawnedLoop('done'));
        expect(await taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context)).toBe('done');
    });

    /** The reference is the only handle on the bytes, and the summary of a run may drop it. */
    test('names the pictures the task loop drew next to what it wrote', async () => {
        const taskLoop = newSpawnedLoop('drew the poster');
        taskLoop.getDrawnImages.mockReturnValue(['dcimg://agent.a1/aa.png']);
        const result = await taskLoopTool.invoke(
            {prompt: 'go', taskId: 'ship-it'}, contextWithTaskLoop(taskLoop)
        );
        expect(result).toContain('drew the poster');
        expect(result).toContain('![image](dcimg://agent.a1/aa.png)');
    });

    test('refuses to run without a task to work on', async () => {
        const context = contextWithTaskLoop(newSpawnedLoop());
        await expect(taskLoopTool.invoke({prompt: 'go', taskId: ''}, context))
            .rejects.toThrow('Name the task of this project');
        expect(context.actions.newTaskLoop).not.toHaveBeenCalled();
    });

    /** A subagent may only move the step index, and that is refused while the task is todo. */
    test('marks the task ongoing as it hands it over', async () => {
        const context = contextWithTaskLoop(newSpawnedLoop());
        await taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context);
        expect(mocks.updateTask).toHaveBeenCalledExactlyOnceWith('p1', {id: 'ship-it', status: 'ongoing'});
        expect(mocks.fireProjectInfoEvent).toHaveBeenCalledExactlyOnceWith('p1', context);
    });

    /**
     * The board takes an assignee on a todo task and on no other, and ongoing never goes back. A
     * task turned before the run exists is therefore a task stuck with an agent no run can be built
     * for -- which is exactly what the refusal tells the model to fix by handing it to somebody else.
     */
    test('leaves the task in todo when no run can be built to work it', async () => {
        const context = contextWithTaskLoop(newSpawnedLoop());
        vi.mocked(context.actions.newTaskLoop).mockRejectedValue(new Error('This task belongs to "a2"'));
        await expect(taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context))
            .rejects.toThrow('This task belongs to "a2"');
        expect(mocks.updateTask).not.toHaveBeenCalled();
        expect(mocks.finishRun).toHaveBeenCalledExactlyOnceWith('run1');
    });

    test('turns the task ongoing only once there is a run to turn it for', async () => {
        const taskLoop = newSpawnedLoop();
        const context = contextWithTaskLoop(taskLoop);
        const building = pending<FlushAgent>();
        vi.mocked(context.actions.newTaskLoop).mockReturnValue(building.promise);

        const handover = taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context);
        await Promise.resolve();
        expect(mocks.updateTask).not.toHaveBeenCalled();

        building.settle(taskLoop as unknown as FlushAgent);
        await handover;
        expect(mocks.updateTask).toHaveBeenCalledExactlyOnceWith('p1', {id: 'ship-it', status: 'ongoing'});
    });

    /**
     * Two of these run beside each other in one turn, and the only thing between them is the claim:
     * the task is read as free, and from there to claimed nothing may be awaited. Building the loop
     * is an await whoever the task belongs to, so a claim made after it would let the second call
     * through a check the first had not answered yet.
     */
    test('keeps a second call of the same turn off a task the first just claimed', async () => {
        const claimed = new Set<string>();
        mocks.startRun.mockImplementation((run) => {
            claimed.add((run as {taskId: string}).taskId);
            return 'run1';
        });
        mocks.isRunning.mockImplementation((_projectId, taskId) => claimed.has(taskId));
        const taskLoop = newSpawnedLoop();
        const context = contextWithTaskLoop(taskLoop);
        const building = pending<FlushAgent>();
        vi.mocked(context.actions.newTaskLoop).mockReturnValue(building.promise);

        const first = taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context);
        await expect(taskLoopTool.invoke({prompt: 'go too', taskId: 'ship-it'}, context))
            .rejects.toThrow('A subagent is working on "ship it" already');

        building.settle(taskLoop as unknown as FlushAgent);
        await first;
        expect(context.actions.newTaskLoop).toHaveBeenCalledOnce();
    });

    test('leaves a task that is already ongoing where it is', async () => {
        mocks.getTask.mockReturnValue(todoTask('ongoing'));
        const context = contextWithTaskLoop(newSpawnedLoop());
        await taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context);
        expect(mocks.updateTask).not.toHaveBeenCalled();
        expect(context.actions.newTaskLoop)
            .toHaveBeenCalledExactlyOnceWith({projectId: 'p1', taskId: 'ship-it'});
    });

    /** The status of a done task cannot go back, so a subagent could not report on it either. */
    test('refuses a task that is already done', async () => {
        mocks.getTask.mockReturnValue(todoTask('done'));
        const context = contextWithTaskLoop(newSpawnedLoop());
        await expect(taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context))
            .rejects.toThrow('Task "ship it" is done');
        expect(context.actions.newTaskLoop).not.toHaveBeenCalled();
    });

    /** Two subagents on one task would work over each other in the same files. */
    test('refuses a task another subagent is on already', async () => {
        mocks.isRunning.mockReturnValue(true);
        const context = contextWithTaskLoop(newSpawnedLoop());
        await expect(taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context))
            .rejects.toThrow('A subagent is working on "ship it" already');
        expect(mocks.isRunning).toHaveBeenCalledWith('p1', 'ship-it');
        expect(mocks.updateTask).not.toHaveBeenCalled();
        expect(context.actions.newTaskLoop).not.toHaveBeenCalled();
    });

    /** Only a project run is handed the tool, so this is one that named no project to run. */
    test('refuses to hand a task over from a project run that names no project', async () => {
        const context = contextWithTaskLoop(newSpawnedLoop(), '');
        await expect(taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context))
            .rejects.toThrow('This session runs no project');
        expect(mocks.getTask).not.toHaveBeenCalled();
        expect(context.actions.newTaskLoop).not.toHaveBeenCalled();
    });

    /**
     * The plan is the user's to agree to, and a run that hands work out while they are still
     * changing it is the whole of what the start button was put there to stop.
     */
    test('refuses to hand a task over before the user started the project', async () => {
        mocks.getProjectDetail.mockReturnValue(startedProject({startedAt: undefined}));
        const context = contextWithTaskLoop(newSpawnedLoop());
        await expect(taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context))
            .rejects.toThrow('The user has not started this project.');
        expect(mocks.startRun).not.toHaveBeenCalled();
        expect(mocks.updateTask).not.toHaveBeenCalled();
        expect(context.actions.newTaskLoop).not.toHaveBeenCalled();
    });

    /**
     * A run turned away here is a run holding a task it was told marks itself ongoing, and moving
     * it there by hand is a short step to take. Were work in the project an answer to whether the
     * project was started, that step would open this gate -- so it is the date and only the date.
     * A record from before the date existed is dated as the manager loads it.
     */
    test('refuses to hand a task over to a project a run put to work itself', async () => {
        mocks.getProjectDetail.mockReturnValue(
            startedProject({startedAt: undefined, ongoingTasks: ['drafted']})
        );
        const context = contextWithTaskLoop(newSpawnedLoop());
        await expect(taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context))
            .rejects.toThrow('The user has not started this project.');
        expect(context.actions.newTaskLoop).not.toHaveBeenCalled();
    });

    test('refuses a task that the project does not have', async () => {
        mocks.getTask.mockReturnValue(undefined);
        const context = contextWithTaskLoop(newSpawnedLoop());
        await expect(taskLoopTool.invoke({prompt: 'go', taskId: 'ghost'}, context))
            .rejects.toThrow('Task "ghost" not found in project "p1".');
        expect(context.actions.newTaskLoop).not.toHaveBeenCalled();
    });

    test('registers the run while the task loop works and retires it after', async () => {
        const taskLoop = newSpawnedLoop();
        const context = contextWithTaskLoop(taskLoop);
        mocks.getTask.mockReturnValue({id: 'ship-it', title: 'ship it', assignee: 'a2'});
        taskLoop.invoke.mockImplementation(async () => {
            expect(mocks.startRun).toHaveBeenCalledExactlyOnceWith({
                projectId: 'p1', taskId: 'ship-it', agentId: 'a2', startedAt: expect.any(String),
            });
            expect(mocks.finishRun).not.toHaveBeenCalled();
            return {text: 'done', runtime: newTestRuntime()};
        });

        await taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context);

        expect(mocks.finishRun).toHaveBeenCalledExactlyOnceWith('run1');
    });

    /** Whoever handed the task over owns the run when the task names nobody to work on it. */
    test('files a run of an unassigned task under the agent that handed it over', async () => {
        const context = contextWithTaskLoop(newSpawnedLoop());
        mocks.getTask.mockReturnValue({id: 'ship-it', title: 'ship it'});
        await taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context);
        expect(mocks.startRun).toHaveBeenCalledWith(expect.objectContaining({agentId: 'a1'}));
    });

    test('retires the run even when the task loop throws', async () => {
        const taskLoop = newSpawnedLoop();
        taskLoop.invoke.mockRejectedValue(new Error('task loop crashed'));
        const context = contextWithTaskLoop(taskLoop);
        await expect(taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context))
            .rejects.toThrow('task loop crashed');
        expect(mocks.finishRun).toHaveBeenCalledExactlyOnceWith('run1');
    });

    test('tells the browsers about the runs when one starts and when it ends', async () => {
        const context = contextWithTaskLoop(newSpawnedLoop());
        mocks.getRunningTasks.mockReturnValueOnce([{taskId: 'ship-it'}]).mockReturnValueOnce([]);

        await taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context);

        expect(context.actions.agentHandler.onInfoEvent).toHaveBeenNthCalledWith(1, {
            eventType: 'updateRunningTasks', content: [{taskId: 'ship-it'}],
        });
        expect(context.actions.agentHandler.onInfoEvent).toHaveBeenNthCalledWith(2, {
            eventType: 'updateRunningTasks', content: [],
        });
    });

    test('takes the session of the task loop apart once it reported back', async () => {
        const context = contextWithTaskLoop(newSpawnedLoop());
        await taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context);
        expect(mocks.deleteDir).toHaveBeenCalledExactlyOnceWith(SESSION_DIR);
        expect(mocks.dropSession).toHaveBeenCalledExactlyOnceWith(SESSION_DIR);
    });

    test('bills the tokens the task loop spent to the loop that handed the task over', async () => {
        const context = contextWithTaskLoop(newSpawnedLoop('done', {
            cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3,
        }));
        context.runtime.usage = {cachedInputTokens: 10, noCachedInputTokens: 20, outputTokens: 30};
        await taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context);
        expect(context.runtime.usage).toEqual({
            cachedInputTokens: 11, noCachedInputTokens: 22, outputTokens: 33,
        });
    });
});

describe('subLoopTool invoke', () => {

    test('runs the prompt on a freshly spawned sub loop', async () => {
        const subLoop = newSpawnedLoop();
        const context = contextWithSubLoop(subLoop);
        await subLoopTool.invoke({prompt: 'summarise the repo'}, context);
        expect(context.actions.newSubLoop).toHaveBeenCalledOnce();
        expect(subLoop.invoke).toHaveBeenCalledExactlyOnceWith('summarise the repo', {browserId: 'b1'});
    });

    test('returns the text the sub loop produced', async () => {
        const result = await subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(newSpawnedLoop('done')));
        expect(result).toBe('done');
    });

    test('names the pictures the sub loop drew next to what it wrote', async () => {
        const subLoop = newSpawnedLoop('drew the poster');
        subLoop.getDrawnImages.mockReturnValue(['dcimg://agent.a1/aa.png', 'dcimg://agent.a1/bb.png']);
        const result = await subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(subLoop));
        expect(result).toContain('drew the poster');
        expect(result).toContain('![image](dcimg://agent.a1/aa.png)');
        expect(result).toContain('![image](dcimg://agent.a1/bb.png)');
    });

    test('leaves the text alone when the sub loop drew nothing', async () => {
        const result = await subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(newSpawnedLoop('done')));
        expect(result).toBe('done');
    });

    test('cleans up the sub loop session directory once it finished', async () => {
        await subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(newSpawnedLoop()));
        expect(mocks.deleteDir).toHaveBeenCalledExactlyOnceWith(SESSION_DIR);
    });

    test('cleans up the session directory even when the sub loop throws', async () => {
        const subLoop = newSpawnedLoop();
        subLoop.invoke.mockRejectedValue(new Error('sub loop crashed'));
        await expect(subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(subLoop)))
            .rejects.toThrow('sub loop crashed');
        expect(mocks.deleteDir).toHaveBeenCalledExactlyOnceWith(SESSION_DIR);
    });

    test('forgets the session metadata of the sub loop as well', async () => {
        await subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(newSpawnedLoop()));
        expect(mocks.dropSession).toHaveBeenCalledExactlyOnceWith(SESSION_DIR);
    });

    /** A sub loop works a prompt, not a task: nothing of it belongs on the board of a project. */
    test('leaves the project and its runs untouched', async () => {
        await subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(newSpawnedLoop()));
        expect(mocks.getTask).not.toHaveBeenCalled();
        expect(mocks.updateTask).not.toHaveBeenCalled();
        expect(mocks.startRun).not.toHaveBeenCalled();
        expect(mocks.finishRun).not.toHaveBeenCalled();
    });

    test('spawns a sub loop from a cron run as well', async () => {
        const context = contextWithSubLoop(newSpawnedLoop());
        context.role = 'cron';
        context.projectId = 'c1';
        await expect(subLoopTool.invoke({prompt: 'go'}, context)).resolves.toBe('spawned loop answer');
    });

    test('bills the tokens the sub loop spent to its parent', async () => {
        const context = contextWithSubLoop(newSpawnedLoop('done', {
            cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3,
        }));
        context.runtime.usage = {cachedInputTokens: 10, noCachedInputTokens: 20, outputTokens: 30};
        await subLoopTool.invoke({prompt: 'go'}, context);
        expect(context.runtime.usage).toEqual({
            cachedInputTokens: 11, noCachedInputTokens: 22, outputTokens: 33,
        });
    });
});

describe('spawning tool metadata', () => {

    test('hands the tasks of a project out of the main loop only', () => {
        expect(taskLoopTool.parallelSafe).toBe(true);
        expect(taskLoopTool.loopKinds).toEqual(['main']);
        expect(taskLoopTool.agentMode).toEqual(['agent']);
    });

    test('keeps the tasks going out at once down to three', () => {
        expect(taskLoopTool.maxParallel).toBe(3);
    });

    test('lets a task loop spawn sub loops but ends the chain there', () => {
        expect(subLoopTool.parallelSafe).toBe(true);
        expect(subLoopTool.loopKinds).toEqual(['main', 'task']);
        expect(subLoopTool.agentMode).toEqual(['agent']);
    });
});
