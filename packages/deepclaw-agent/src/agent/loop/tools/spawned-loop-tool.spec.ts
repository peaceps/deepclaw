import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type FlushAgent, type TokenUsage} from '@deepclaw/core';
import {newTestContext, newTestRuntime} from '../../../test-support/one-loop-context';
import {type FootPrint, type OneLoopContext} from '../../definitions/definitions';
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
    isTaskLoopRunning: vi.fn<(projectId: string, taskId: string) => boolean>(() => false),
    isReviewRunning: vi.fn<(projectId: string, taskId: string) => boolean>(() => false),
    dropMainLoopRun: vi.fn<(loopId: string, projectId: string, taskId: string) => boolean>(() => false),
    verdict: vi.fn<(projectId: string, taskId: string) => string>(() => ''),
}));

function todoTask(status = 'todo') {
    return {id: 'ship-it', title: 'ship it', status};
}

/** As most of them stand by the time a task goes out: the work was set going before it. */
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
    promptTaskVerdict: mocks.verdict,
}}));

vi.mock('../services/running-task-service', () => ({
    RunningTaskService: {
        startTaskLoopRun: mocks.startRun, finishTaskLoopRun: mocks.finishRun,
        getRunningTasks: mocks.getRunningTasks, isTaskLoopRunning: mocks.isTaskLoopRunning,
        isReviewRunning: mocks.isReviewRunning, dropMainLoopRun: mocks.dropMainLoopRun,
    },
    // Said the same way the service says it, the list of runs being the mocked one.
    fireRunningTasksEvent: (context: OneLoopContext) => context.actions.agentHandler.onInfoEvent({
        eventType: 'updateRunningTasks', content: mocks.getRunningTasks() as never,
    }),
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
        getChangeTrace: vi.fn<() => FootPrint[]>(() => []),
    };
}

type SpawnedLoopMock = ReturnType<typeof newSpawnedLoop>;

/** How a failed run comes back: a line saying what went wrong, and the reason on the run itself. */
function failed(loop: SpawnedLoopMock, changes: FootPrint[]): SpawnedLoopMock {
    loop.invoke.mockResolvedValue({
        text: 'Error in loop, context too long.', runtime: newTestRuntime({transitionReason: 'error'}),
    });
    loop.getChangeTrace.mockReturnValue(changes);
    return loop;
}

function commands(count: number): FootPrint[] {
    return Array.from({length: count}, (_, index) => ({type: 'run_command', content: `step${index + 1}`}));
}

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

function contextWithSubLoop(subLoop: SpawnedLoopMock, overrides: Partial<OneLoopContext> = {}): OneLoopContext {
    const context = newTestContext(overrides);
    vi.mocked(context.actions.newSubLoop).mockReturnValue(subLoop as unknown as FlushAgent);
    return context;
}

/** A loop that was spawned itself, which is the only kind ever asked for an account of the work. */
function taskLoopContextWithSubLoop(subLoop: SpawnedLoopMock): OneLoopContext {
    return contextWithSubLoop(subLoop, {loopKind: 'task'});
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTask.mockReturnValue(todoTask());
    mocks.getProjectDetail.mockReturnValue(startedProject());
    mocks.isTaskLoopRunning.mockReturnValue(false);
    mocks.isReviewRunning.mockReturnValue(false);
    mocks.verdict.mockReturnValue('');
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

    /**
     * The word of the reviewer rather than the word of the reviewed: a subagent whose work was
     * turned down writes its own report, and this loop is the one about to call the task finished.
     */
    test('says what the reviewer left on the task under what the subagent wrote', async () => {
        mocks.verdict.mockReturnValue('Review by Eve: rejected. The tests were never run.');
        const context = contextWithTaskLoop(newSpawnedLoop('shipped it'));
        const result = await taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context);
        expect(result).toBe('shipped it\n\nReview by Eve: rejected. The tests were never run.');
        expect(mocks.verdict).toHaveBeenCalledExactlyOnceWith('p1', 'ship-it');
    });

    test('leaves the answer as it stands where nobody read the task over', async () => {
        const context = contextWithTaskLoop(newSpawnedLoop('shipped it'));
        expect(await taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context)).toBe('shipped it');
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
        mocks.isTaskLoopRunning.mockImplementation((_projectId, taskId) => claimed.has(taskId));
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
        mocks.isTaskLoopRunning.mockReturnValue(true);
        const context = contextWithTaskLoop(newSpawnedLoop());
        await expect(taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context))
            .rejects.toThrow('A subagent is working on "ship it" already');
        expect(mocks.isTaskLoopRunning).toHaveBeenCalledWith('p1', 'ship-it');
        expect(mocks.updateTask).not.toHaveBeenCalled();
        expect(context.actions.newTaskLoop).not.toHaveBeenCalled();
    });

    /**
     * The reader is reading what is there now. Work started under it would move the ground it stands
     * on, and the verdict it came to would be about a task that no longer looks that way.
     */
    test('refuses a task that is being read over right now', async () => {
        mocks.isReviewRunning.mockReturnValue(true);
        const context = contextWithTaskLoop(newSpawnedLoop());
        await expect(taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context))
            .rejects.toThrow('"ship it" is being read over right now');
        expect(mocks.updateTask).not.toHaveBeenCalled();
        expect(context.actions.newTaskLoop).not.toHaveBeenCalled();
    });

    /**
     * The asking run is no exception to a reading, where it is to a task loop of its own: what it
     * would be handing the subagent is the very work somebody is looking at.
     */
    test('refuses a task it was working itself while that work is being read over', async () => {
        mocks.isReviewRunning.mockReturnValue(true);
        const context = contextWithTaskLoop(newSpawnedLoop());
        await expect(taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context))
            .rejects.toThrow('"ship it" is being read over right now');
        expect(mocks.dropMainLoopRun).not.toHaveBeenCalled();
    });

    /**
     * A run that was working the task itself and is handing it over after all. It is not the one on
     * it from here, and its own word is what it takes back: what another loop said of itself stands
     * until that loop's own turn ends.
     */
    test('hands over a task it was working itself, and lets go of it', async () => {
        const context = contextWithTaskLoop(newSpawnedLoop());
        await taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context);
        expect(mocks.dropMainLoopRun).toHaveBeenCalledExactlyOnceWith('agent.a1', 'p1', 'ship-it');
        expect(context.actions.newTaskLoop).toHaveBeenCalled();
    });

    /** Nothing was handed over, so what the run was working is still what it is working. */
    test('leaves what it was working alone where the handover was refused', async () => {
        mocks.getTask.mockReturnValue(todoTask('done'));
        const context = contextWithTaskLoop(newSpawnedLoop());
        await expect(taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context))
            .rejects.toThrow('never goes back to ongoing');
        expect(mocks.dropMainLoopRun).not.toHaveBeenCalled();
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
     * The user asking for the work is the work beginning, and the task leaving todo is what says so:
     * the date falls out of that write, wherever the project stood before it. Nothing is asked of
     * the start date here, a run only ever reaching this because the user said something to it.
     */
    test('hands a task over on a project the user never pressed start on', async () => {
        mocks.getProjectDetail.mockReturnValue(startedProject({startedAt: undefined}));
        const context = contextWithTaskLoop(newSpawnedLoop());
        await taskLoopTool.invoke({prompt: 'go', taskId: 'ship-it'}, context);
        expect(mocks.updateTask).toHaveBeenCalledWith('p1', {id: 'ship-it', status: 'ongoing'});
        expect(context.actions.newTaskLoop).toHaveBeenCalled();
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

    /**
     * The session behind the error line is deleted a moment later, so this is the only chance the
     * loop above gets to hear that half its files were already written.
     */
    test('hands up what the sub loop changed before it failed', async () => {
        const subLoop = failed(newSpawnedLoop(), [
            {type: 'write_file', content: 'src/b.ts'},
            {type: 'run_command', content: 'npm test'},
        ]);
        const result = await subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(subLoop));
        expect(result).toContain('Error in loop, context too long.');
        expect(result).toContain('write_file: src/b.ts');
        expect(result).toContain('run_command: npm test');
    });

    /** A model that will not answer leaves the same half-written files behind as a crash. */
    test('hands up what the sub loop changed before it refused', async () => {
        const subLoop = newSpawnedLoop();
        subLoop.invoke.mockResolvedValue({
            text: 'The model refused.', runtime: newTestRuntime({transitionReason: 'refused'}),
        });
        subLoop.getChangeTrace.mockReturnValue([{type: 'write_file', content: 'src/b.ts'}]);
        const result = await subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(subLoop));
        expect(result).toContain('write_file: src/b.ts');
    });

    /**
     * The ending a run that used up its turns comes back with is the ending of a run that had said
     * everything it had to say, so the reason alone would have this one pass for an answer.
     */
    test('hands up what the sub loop changed before it ran out of turns', async () => {
        const subLoop = newSpawnedLoop();
        subLoop.invoke.mockResolvedValue({
            text: 'Now I will update the tests.',
            runtime: newTestRuntime({transitionReason: 'endLoop', hitTurnLimit: true}),
        });
        subLoop.getChangeTrace.mockReturnValue([{type: 'write_file', content: 'src/b.ts'}]);
        const result = await subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(subLoop));
        expect(result).toContain('Now I will update the tests.');
        expect(result).toContain('write_file: src/b.ts');
    });

    /** A run that answered has said what it did, in words worth more than a list of paths. */
    test('says nothing of the steps of a sub loop that answered', async () => {
        const subLoop = newSpawnedLoop('done');
        subLoop.getChangeTrace.mockReturnValue(commands(3));
        expect(await subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(subLoop))).toBe('done');
    });

    /**
     * The run is a tree and its account has to be one too: what a subagent changed is gone with its
     * session, and the loop above is the only place left that can still report it.
     */
    test('keeps what the sub loop changed on the task loop that spawned it', async () => {
        const subLoop = failed(newSpawnedLoop(), [
            {type: 'write_file', content: 'src/b.ts'},
            {type: 'run_command', content: 'npm test'},
        ]);
        const context = taskLoopContextWithSubLoop(subLoop);
        await subLoopTool.invoke({prompt: 'go'}, context);
        expect(context.actions.addFootPrint).toHaveBeenCalledTimes(2);
        expect(context.actions.addFootPrint)
            .toHaveBeenCalledWith({type: 'write_file', content: 'src/b.ts', viaSubagent: true});
        expect(context.actions.addFootPrint)
            .toHaveBeenCalledWith({type: 'run_command', content: 'npm test', viaSubagent: true});
    });

    test('keeps what a sub loop changed before it crashed as well', async () => {
        const subLoop = newSpawnedLoop();
        subLoop.invoke.mockRejectedValue(new Error('sub loop crashed'));
        subLoop.getChangeTrace.mockReturnValue([{type: 'write_file', content: 'src/b.ts'}]);
        const context = taskLoopContextWithSubLoop(subLoop);
        await expect(subLoopTool.invoke({prompt: 'go'}, context)).rejects.toThrow('sub loop crashed');
        expect(context.actions.addFootPrint)
            .toHaveBeenCalledExactlyOnceWith({type: 'write_file', content: 'src/b.ts', viaSubagent: true});
    });

    /**
     * A throw is what the loop above is told this call was, and a run that threw is the likeliest
     * of all to have left a file half written. Carried up it would be read by nobody until the
     * loop above failed in its own right, and by nothing at all where that loop is a main one.
     */
    test('reports what a sub loop changed before it threw', async () => {
        const subLoop = newSpawnedLoop();
        subLoop.invoke.mockRejectedValue(new Error('sub loop crashed'));
        subLoop.getChangeTrace.mockReturnValue([
            {type: 'write_file', content: 'src/b.ts'},
            {type: 'run_background_command', content: 'npm run dev'},
        ]);
        await expect(subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(subLoop)))
            .rejects.toThrow(/sub loop crashed[\s\S]*write_file: src\/b\.ts[\s\S]*run_background_command: npm run dev/);
    });

    test('leaves a throw with nothing behind it as it came', async () => {
        const subLoop = newSpawnedLoop();
        const crash = new Error('sub loop crashed');
        subLoop.invoke.mockRejectedValue(crash);
        await expect(subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(subLoop)))
            .rejects.toBe(crash);
    });

    /**
     * Nothing ever asks a main loop what it changed: it answers a user, in words it wrote itself.
     * Kept anyway, the changes of every subagent of a whole conversation would pile up unread.
     */
    test('leaves the changes of a sub loop off a main loop', async () => {
        const subLoop = failed(newSpawnedLoop(), [{type: 'write_file', content: 'src/b.ts'}]);
        const context = contextWithSubLoop(subLoop);
        await subLoopTool.invoke({prompt: 'go'}, context);
        expect(context.actions.addFootPrint).not.toHaveBeenCalled();
    });

    /** A branch is not a step of the run: what took it is gone, and cannot be asked after. */
    test('names a step it was handed by a subagent as one', async () => {
        const subLoop = failed(newSpawnedLoop(), [
            {type: 'write_file', content: 'src/b.ts'},
            {type: 'run_background_command', content: 'npm run dev', viaSubagent: true},
        ]);
        const result = await subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(subLoop));
        expect(result).toContain('write_file: src/b.ts');
        expect(result).toContain('run_background_command (subagent): npm run dev');
    });

    /** Where the work stopped is what the loop above needs, and that is the end of the list. */
    test('keeps the last steps of a long run and says how many it left out', async () => {
        const subLoop = failed(newSpawnedLoop(), commands(25));
        const result = await subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(subLoop));
        expect(result).toContain('changesCut {\\"count\\":5}');
        expect(result).toContain('run_command: step25');
        expect(result).toContain('run_command: step6');
        expect(result).not.toContain('run_command: step5');
    });

    test('reads every step as one line, however long the command was', async () => {
        const subLoop = failed(newSpawnedLoop(), [
            {type: 'run_command', content: `echo ${'y'.repeat(300)}`},
            {type: 'run_command', content: 'cat <<EOF > /tmp/x\n  body\nEOF'},
        ]);
        const result = await subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(subLoop));
        expect(result).toContain(`echo ${'y'.repeat(115)}...`);
        expect(result).not.toContain('y'.repeat(116));
        expect(result).toContain('cat <<EOF > /tmp/x body EOF');
    });

    /** Nothing to report is not a report saying nothing happened. */
    test('leaves a failure with no steps behind it as it came', async () => {
        const subLoop = failed(newSpawnedLoop(), []);
        expect(await subLoopTool.invoke({prompt: 'go'}, contextWithSubLoop(subLoop)))
            .toBe('Error in loop, context too long.');
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
