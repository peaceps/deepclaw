import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type FlushAgent} from '@deepclaw/core';
import {newTestContext, newTestRuntime} from '../../../test-support/one-loop-context';
import {type OneLoopContext} from '../../definitions/definitions';
import {reviewTaskTool, submitReviewTool} from './review-tool';

const mocks = vi.hoisted(() => ({
    getTask: vi.fn<(projectId: string, taskId: string) => unknown>(),
    submitReview: vi.fn<(...args: unknown[]) => void>(),
    verdict: vi.fn<(projectId: string, taskId: string) => string>(() => 'Review by Eve: passed.'),
    fireProjectInfoEvent: vi.fn<(projectId: string, context: unknown) => void>(),
    startRun: vi.fn<(run: unknown) => string>(() => 'run1'),
    finishRun: vi.fn<(runId: string) => void>(),
    getRunningTasks: vi.fn<() => unknown[]>(() => []),
    isTaskLoopRunning: vi.fn<(projectId: string, taskId: string) => boolean>(() => false),
    isReviewRunning: vi.fn<(projectId: string, taskId: string) => boolean>(() => false),
    runSpawnedLoop: vi.fn<(...args: unknown[]) => Promise<string>>(async () => 'read it'),
}));

/** A task as it has to stand for a reading: under way, and with somebody named to read it. */
function reviewable(overrides: Record<string, unknown> = {}) {
    return {id: 'ship-it', title: 'ship it', status: 'ongoing', reviewer: 'a3', ...overrides};
}

/** What a reading leaves behind, which is the whole of how anybody knows it came to anything. */
function verdictOn(at: string): Record<string, unknown> {
    return {review: {verdict: 'passed', at}};
}

vi.mock('../services/project-manager', () => ({ProjectManager: {
    getTask: mocks.getTask,
    submitReview: mocks.submitReview,
    promptTaskVerdict: mocks.verdict,
    fireProjectInfoEvent: mocks.fireProjectInfoEvent,
}}));

vi.mock('../services/running-task-service', () => ({
    RunningTaskService: {
        startReviewRun: mocks.startRun, finishReviewRun: mocks.finishRun,
        getRunningTasks: mocks.getRunningTasks,
        isTaskLoopRunning: mocks.isTaskLoopRunning, isReviewRunning: mocks.isReviewRunning,
    },
    fireRunningTasksEvent: (context: OneLoopContext) => context.actions.agentHandler.onInfoEvent({
        eventType: 'updateRunningTasks', content: mocks.getRunningTasks() as never,
    }),
}));

vi.mock('./spawned-loop-tool', () => ({runSpawnedLoop: mocks.runSpawnedLoop}));

/** The reading is asked for from a project run, and the loop it spawns is stubbed out here. */
function reviewContext(overrides: Partial<OneLoopContext> = {}): OneLoopContext {
    const context = newTestContext({projectId: 'p1', role: 'project', ...overrides});
    vi.mocked(context.actions.newReviewLoop).mockResolvedValue({} as FlushAgent);
    return context;
}

/** The run that was spawned to read, which is the only run submit_review is ever called from. */
function readerContext(taskId = 'ship-it'): OneLoopContext {
    return newTestContext({
        projectId: 'p1', role: 'project', loopKind: 'review',
        assignedTask: {projectId: 'p1', taskId},
        runtime: newTestRuntime(),
    });
}

const REPORT = {type: 'markdown' as const, content: 'The tests run and they pass.'};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTask.mockReturnValue(reviewable());
    mocks.isTaskLoopRunning.mockReturnValue(false);
    mocks.isReviewRunning.mockReturnValue(false);
    mocks.startRun.mockReturnValue('run1');
    mocks.verdict.mockReturnValue('Review by Eve: passed.');
    // A reading that went as it should: what it filed is on the task by the time it comes back.
    mocks.runSpawnedLoop.mockImplementation(async () => {
        mocks.getTask.mockReturnValue(reviewable(verdictOn('2026-01-02T00:00:00.000Z')));
        return 'read it';
    });
});

describe('review_task', () => {

    test('has the reviewer of the named task read it over', async () => {
        const context = reviewContext();
        await reviewTaskTool.invoke({taskId: 'ship-it', prompt: 'the tests are in api.spec.ts'}, context);
        expect(context.actions.newReviewLoop)
            .toHaveBeenCalledExactlyOnceWith({projectId: 'p1', taskId: 'ship-it'});
        expect(mocks.runSpawnedLoop).toHaveBeenCalledWith(
            expect.anything(), 'the tests are in api.spec.ts', context
        );
    });

    /**
     * The user closing the task while it was being read writes a waiver dated now, new enough to
     * pass for this run's own answer -- and there is no verdict behind it, so the prompt for one is
     * empty. Said here instead: an empty tool result tells the model nothing, and some providers
     * will not carry one at all.
     */
    test('says so where the user closed the task while it was being read', async () => {
        mocks.runSpawnedLoop.mockImplementation(async () => {
            mocks.getTask.mockReturnValue(reviewable({
                status: 'done', review: {verdict: 'waived', at: '2026-01-02T00:00:00.000Z'},
            }));
            return 'read it';
        });
        mocks.verdict.mockReturnValue('');
        const result = await reviewTaskTool.invoke({taskId: 'ship-it', prompt: 'go'}, reviewContext());
        expect(result).toContain('The user closed "ship it" themselves while it was being read over');
        expect(result).not.toBe('');
    });

    /** The verdict off the task rather than out of the run: the run's own words go nowhere. */
    test('answers with the verdict the reading left on the task', async () => {
        mocks.verdict.mockReturnValue('Review by Eve: rejected. Nothing was run.');
        const result = await reviewTaskTool.invoke({taskId: 'ship-it', prompt: 'go'}, reviewContext());
        expect(result).toBe('Review by Eve: rejected. Nothing was run.');
    });

    /**
     * Filed under the reviewer and not under whoever the task belongs to: the board draws a run on
     * the line of the agent it is filed under, and this one belongs on the reader's.
     */
    test('puts the run on the board under the agent doing the reading', async () => {
        const context = reviewContext();
        await reviewTaskTool.invoke({taskId: 'ship-it', prompt: 'go'}, context);
        expect(mocks.startRun).toHaveBeenCalledExactlyOnceWith({
            projectId: 'p1', taskId: 'ship-it', agentId: 'a3', startedAt: expect.any(String),
        });
        expect(context.actions.agentHandler.onInfoEvent)
            .toHaveBeenCalledWith(expect.objectContaining({eventType: 'updateRunningTasks'}));
    });

    test('retires the run once the reading is over', async () => {
        await reviewTaskTool.invoke({taskId: 'ship-it', prompt: 'go'}, reviewContext());
        expect(mocks.finishRun).toHaveBeenCalledExactlyOnceWith('run1');
    });

    test('retires the run even where no loop could be built to read with', async () => {
        const context = reviewContext();
        vi.mocked(context.actions.newReviewLoop).mockRejectedValue(new Error('Agent "a3" not found'));
        await expect(reviewTaskTool.invoke({taskId: 'ship-it', prompt: 'go'}, context))
            .rejects.toThrow('Agent "a3" not found');
        expect(mocks.finishRun).toHaveBeenCalledExactlyOnceWith('run1');
    });

    /**
     * A run that ended without filing anything. Read as a pass it would let the task close on the
     * strength of a reading that never happened, so it is handed up as the failure it is -- with
     * whatever the run died of, that being the whole of what anybody knows about it.
     */
    test('refuses to answer for a reading that filed no verdict', async () => {
        mocks.runSpawnedLoop.mockRejectedValue(new Error('Error in loop, context too long.'));
        await expect(reviewTaskTool.invoke({taskId: 'ship-it', prompt: 'go'}, reviewContext()))
            .rejects.toThrow('The review of "ship it" came back without a verdict '
                + '(Error in loop, context too long.). Run it once more, or tell the user what '
                + 'happened and leave the task open.');
    });

    /**
     * A verdict from an earlier reading is not an answer to this one. The time and not the record:
     * a project read back from disk answers with an equal review that is a different object.
     */
    test('refuses where the only verdict on the task is the one that was already there', async () => {
        mocks.getTask.mockReturnValue(reviewable(verdictOn('2026-01-01T00:00:00.000Z')));
        mocks.runSpawnedLoop.mockResolvedValue('read it');
        await expect(reviewTaskTool.invoke({taskId: 'ship-it', prompt: 'go'}, reviewContext()))
            .rejects.toThrow('came back without a verdict.');
    });

    test('refuses without a task to read', async () => {
        await expect(reviewTaskTool.invoke({taskId: '', prompt: 'go'}, reviewContext()))
            .rejects.toThrow('Name the task of this project that has to be read over.');
    });

    test('refuses from a project run that names no project', async () => {
        await expect(reviewTaskTool.invoke(
            {taskId: 'ship-it', prompt: 'go'}, reviewContext({projectId: ''})
        )).rejects.toThrow('This session runs no project');
    });

    test('refuses a task that is not on the board', async () => {
        mocks.getTask.mockReturnValue(undefined);
        await expect(reviewTaskTool.invoke({taskId: 'ghost', prompt: 'go'}, reviewContext()))
            .rejects.toThrow('Task "ghost" not found in project "p1".');
    });

    /** A task without a reviewer closes on the word of whoever is working it, and says so. */
    test('refuses a task nobody was named to read', async () => {
        mocks.getTask.mockReturnValue(reviewable({reviewer: undefined}));
        await expect(reviewTaskTool.invoke({taskId: 'ship-it', prompt: 'go'}, reviewContext()))
            .rejects.toThrow('Nobody reads "ship it" over: it has no reviewer');
    });

    test('refuses a task that is not under way', async () => {
        mocks.getTask.mockReturnValue(reviewable({status: 'todo'}));
        await expect(reviewTaskTool.invoke({taskId: 'ship-it', prompt: 'go'}, reviewContext()))
            .rejects.toThrow('Only work under way is read over, and "ship it" is todo.');
    });

    test('refuses a task somebody is already reading over', async () => {
        mocks.isReviewRunning.mockReturnValue(true);
        const context = reviewContext();
        await expect(reviewTaskTool.invoke({taskId: 'ship-it', prompt: 'go'}, context))
            .rejects.toThrow('"ship it" is being read over right now, wait for that verdict.');
        expect(mocks.startRun).not.toHaveBeenCalled();
        expect(context.actions.newReviewLoop).not.toHaveBeenCalled();
    });

    /** A workspace being written while it is read: the verdict would be about neither state. */
    test('refuses a task a subagent is working from the main loop', async () => {
        mocks.isTaskLoopRunning.mockReturnValue(true);
        await expect(reviewTaskTool.invoke({taskId: 'ship-it', prompt: 'go'}, reviewContext()))
            .rejects.toThrow('A subagent is working on "ship it" right now.');
    });

    /**
     * The run it would be waiting for is the loop asking, and it is asking between two edits. Only
     * subagents are asked after, so a task the main loop works itself never reaches this.
     */
    test('reads over a task the main loop is working with its own hands', async () => {
        const context = reviewContext();
        await reviewTaskTool.invoke({taskId: 'ship-it', prompt: 'go'}, context);
        expect(context.actions.newReviewLoop).toHaveBeenCalled();
        expect(mocks.isTaskLoopRunning).toHaveBeenCalledWith('p1', 'ship-it');
    });

    /**
     * The work under way on the task is this very run, and it is on the list of subagents itself:
     * asked from down here the question would have every task loop refusing its own review.
     */
    test('lets a task loop have its own work read over while it is doing it', async () => {
        mocks.isTaskLoopRunning.mockReturnValue(true);
        const context = reviewContext({
            loopKind: 'task', assignedTask: {projectId: 'p1', taskId: 'ship-it'},
        });
        await reviewTaskTool.invoke({taskId: 'ship-it', prompt: 'go'}, context);
        expect(context.actions.newReviewLoop).toHaveBeenCalled();
    });

    /** A subagent has no business with a sibling task, whatever it thinks of the state of it. */
    test('keeps a task loop to the task it was given', async () => {
        const context = reviewContext({
            loopKind: 'task', assignedTask: {projectId: 'p1', taskId: 'write-tests'},
        });
        await expect(reviewTaskTool.invoke({taskId: 'ship-it', prompt: 'go'}, context))
            .rejects.toThrow('You were given "write-tests" and can only ask for a review of that task.');
    });

    test('goes to the loop that runs a project and to no other run', () => {
        expect(reviewTaskTool.loopKinds).toEqual(['main', 'task']);
        expect(reviewTaskTool.roles).toEqual(['project']);
    });
});

describe('submit_review', () => {

    test('writes the verdict and the report onto the task the run was given', async () => {
        const context = readerContext();
        await submitReviewTool.invoke({verdict: 'passed', output: REPORT}, context);
        expect(mocks.submitReview)
            .toHaveBeenCalledExactlyOnceWith('p1', 'ship-it', 'passed', REPORT);
        expect(mocks.fireProjectInfoEvent).toHaveBeenCalledExactlyOnceWith('p1', context);
    });

    test('tells the run that its verdict is in and there is nothing else to do', async () => {
        const result = await submitReviewTool.invoke({verdict: 'rejected', output: REPORT}, readerContext());
        expect(result).toContain('Your verdict is on "ship it"');
    });

    /** A review that named its own task could file a report on a task nobody asked it to read. */
    test('refuses where the run was given no task to read', async () => {
        await expect(submitReviewTool.invoke(
            {verdict: 'passed', output: REPORT}, newTestContext({projectId: 'p1', loopKind: 'review'})
        )).rejects.toThrow('This run was given no task to read over.');
        expect(mocks.submitReview).not.toHaveBeenCalled();
    });

    test('refuses where the task it was reading is gone from the board', async () => {
        mocks.getTask.mockReturnValue(undefined);
        await expect(submitReviewTool.invoke({verdict: 'passed', output: REPORT}, readerContext()))
            .rejects.toThrow('The task you were reading is no longer on the board.');
    });

    /** Nothing is written on a closed task, and the run is told so rather than left to retry. */
    test('writes nothing on a task that was closed while it read', async () => {
        mocks.getTask.mockReturnValue(reviewable({status: 'done'}));
        const result = await submitReviewTool.invoke(
            {verdict: 'passed', output: REPORT}, readerContext()
        );
        expect(result).toContain('was closed while you were reading it');
        expect(mocks.submitReview).not.toHaveBeenCalled();
    });

    /** A review has nothing to hand over but words, and a file handed over is not a finding. */
    test('refuses a report that is not read but opened', async () => {
        await expect(submitReviewTool.invoke(
            {verdict: 'passed', output: {type: 'binary', content: 'AAAA'}}, readerContext()
        )).rejects.toThrow('A report is read, not opened.');
        expect(mocks.submitReview).not.toHaveBeenCalled();
    });

    test('goes to the run that was spawned to read and to no other', () => {
        expect(submitReviewTool.loopKinds).toEqual(['review']);
    });
});
