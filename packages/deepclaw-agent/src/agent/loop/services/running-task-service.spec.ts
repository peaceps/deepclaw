import {afterEach, describe, expect, test, vi} from 'vitest';
import {type RunningTask} from '@deepclaw/core';
import {pauseHandWork, resumeHandWork, RunningTaskService} from './running-task-service';
import {newTestContext} from '../../../test-support/one-loop-context';

const mocks = vi.hoisted(() => ({
    getTask: vi.fn<(projectId: string, taskId: string) => unknown>(),
}));

vi.mock('./project-manager', () => ({ProjectManager: {getTask: mocks.getTask}}));

/** The service is a singleton, so whatever a test started has to be retired after it. */
const started: string[] = [];

function start(overrides: Partial<RunningTask> = {}): string {
    const runId = RunningTaskService.start(newRun(overrides));
    started.push(runId);
    return runId;
}

function newRun(overrides: Partial<Omit<RunningTask, 'runId'>> = {}): Omit<RunningTask, 'runId'> {
    return {
        projectId: 'p1',
        taskId: 'ship-it',
        agentId: 'a1',
        startedAt: '2026-08-13T07:00:00.000Z',
        ...overrides,
    };
}

afterEach(() => {
    started.splice(0).forEach(runId => RunningTaskService.finish(runId));
    ['project.a1.p1', 'project.a2.p1'].forEach(loopId => RunningTaskService.dropByHand(loopId));
    vi.clearAllMocks();
});

describe('RunningTaskService', () => {

    test('has nothing running before anything started', () => {
        expect(RunningTaskService.getRunningTasks()).toEqual([]);
    });

    test('lists a run from the moment it started until it finished', () => {
        const runId = start();
        expect(RunningTaskService.getRunningTasks()).toEqual([{...newRun(), runId}]);
        RunningTaskService.finish(runId);
        expect(RunningTaskService.getRunningTasks()).toEqual([]);
    });

    test('keeps the runs of several subagents apart', () => {
        const first = start();
        const second = start({taskId: 'write-tests', agentId: 'a2'});
        RunningTaskService.finish(first);
        expect(RunningTaskService.getRunningTasks())
            .toEqual([{...newRun({taskId: 'write-tests', agentId: 'a2'}), runId: second}]);
    });

    /** Two runs of one task are told apart by their handle, never by what they point at. */
    test('retires only the run that finished when one task runs twice', () => {
        const first = start();
        const second = start({startedAt: '2026-08-13T08:00:00.000Z'});
        RunningTaskService.finish(first);
        expect(RunningTaskService.getRunningTasks())
            .toEqual([{...newRun({startedAt: '2026-08-13T08:00:00.000Z'}), runId: second}]);
    });

    test('gives every run a handle of its own', () => {
        expect(start()).not.toBe(start());
    });

    test('ignores a handle that was already retired', () => {
        const runId = start();
        RunningTaskService.finish(runId);
        RunningTaskService.finish(runId);
        expect(RunningTaskService.getRunningTasks()).toEqual([]);
    });
});

/**
 * A loop working a task with its own hands says so once and goes on working it across the turns
 * that follow, and only what is executing is a run: the hold stands the whole way, the run of it
 * comes and goes with the turns.
 */
describe('a task taken on by hand', () => {

    test('runs from the moment the loop says it is working it', () => {
        RunningTaskService.takeByHand('project.a1.p1', newRun());
        expect(RunningTaskService.getRunningTasks())
            .toEqual([{...newRun(), runId: expect.any(String)}]);
        expect(RunningTaskService.isRunning('p1', 'ship-it')).toBe(true);
    });

    test('stops running when the turn ends and is held on to all the same', () => {
        RunningTaskService.takeByHand('project.a1.p1', newRun());
        RunningTaskService.pauseByHand('project.a1.p1');
        expect(RunningTaskService.getRunningTasks()).toEqual([]);
        expect(RunningTaskService.takenByHand('project.a1.p1')).toEqual(newRun());
    });

    test('runs again on the turn after that, without being said again', () => {
        RunningTaskService.takeByHand('project.a1.p1', newRun());
        RunningTaskService.pauseByHand('project.a1.p1');
        RunningTaskService.resumeByHand('project.a1.p1');
        expect(RunningTaskService.getRunningTasks())
            .toEqual([{...newRun(), runId: expect.any(String)}]);
    });

    /** Two turns cannot be under way at once, and the second word would leave the first run adrift. */
    test('is one run however often the turn is resumed', () => {
        RunningTaskService.takeByHand('project.a1.p1', newRun());
        RunningTaskService.resumeByHand('project.a1.p1');
        expect(RunningTaskService.getRunningTasks().length).toBe(1);
    });

    test('resumes nothing for a loop that took nothing on', () => {
        RunningTaskService.resumeByHand('project.a1.p1');
        expect(RunningTaskService.getRunningTasks()).toEqual([]);
        expect(RunningTaskService.takenByHand('project.a1.p1')).toBeUndefined();
    });

    test('is let go of run and hold together', () => {
        RunningTaskService.takeByHand('project.a1.p1', newRun());
        RunningTaskService.dropByHand('project.a1.p1');
        expect(RunningTaskService.getRunningTasks()).toEqual([]);
        expect(RunningTaskService.takenByHand('project.a1.p1')).toBeUndefined();
        RunningTaskService.resumeByHand('project.a1.p1');
        expect(RunningTaskService.getRunningTasks()).toEqual([]);
    });

    /** One task at a time: a loop is answering one turn, and the last word of it is where it is. */
    test('leaves no run behind when the loop moves to another task', () => {
        RunningTaskService.takeByHand('project.a1.p1', newRun());
        RunningTaskService.takeByHand('project.a1.p1', newRun({taskId: 'write-tests'}));
        expect(RunningTaskService.getRunningTasks())
            .toEqual([{...newRun({taskId: 'write-tests'}), runId: expect.any(String)}]);
        expect(RunningTaskService.takenByHand('project.a1.p1'))
            .toEqual(newRun({taskId: 'write-tests'}));
    });

    test('keeps what two loops took on apart', () => {
        RunningTaskService.takeByHand('project.a1.p1', newRun());
        RunningTaskService.takeByHand('project.a2.p1', newRun({taskId: 'write-tests', agentId: 'a2'}));
        RunningTaskService.pauseByHand('project.a1.p1');
        expect(RunningTaskService.getRunningTasks())
            .toEqual([{...newRun({taskId: 'write-tests', agentId: 'a2'}), runId: expect.any(String)}]);
        expect(RunningTaskService.takenByHand('project.a1.p1')).toEqual(newRun());
    });

    /** The run of a subagent is nobody's to pause, and the hold of a loop is nobody's to finish. */
    test('leaves the run of a subagent alone', () => {
        start();
        RunningTaskService.takeByHand('project.a1.p1', newRun({taskId: 'write-tests'}));
        RunningTaskService.dropByHand('project.a1.p1');
        expect(RunningTaskService.getRunningTasks()).toEqual([{...newRun(), runId: expect.any(String)}]);
    });
});

/**
 * The two ends of a turn of the loop that holds the work. What the board says is asked at the
 * start of each: between two turns anything may have closed the task, and none of those is a place
 * that knows a hold was ever taken.
 */
describe('the turns of a hold', () => {

    function newContext() {
        const context = newTestContext({loopId: 'project.a1.p1'});
        return {context, fired: context.actions.agentHandler.onInfoEvent as ReturnType<typeof vi.fn>};
    }

    function runningTaskEvents(fired: ReturnType<typeof vi.fn>): unknown[] {
        return fired.mock.calls.map(call => call[0])
            .filter((event: any) => event.eventType === 'updateRunningTasks');
    }

    test('runs again for a turn that begins, and rests when it ends', () => {
        const {context, fired} = newContext();
        RunningTaskService.takeByHand('project.a1.p1', newRun());
        RunningTaskService.pauseByHand('project.a1.p1');
        mocks.getTask.mockReturnValue({id: 'ship-it', status: 'ongoing'});

        resumeHandWork(context);
        expect(RunningTaskService.getRunningTasks())
            .toEqual([{...newRun(), runId: expect.any(String)}]);
        pauseHandWork(context);
        expect(RunningTaskService.getRunningTasks()).toEqual([]);
        expect(RunningTaskService.takenByHand('project.a1.p1')).toEqual(newRun());
        expect(runningTaskEvents(fired).length).toBe(2);
    });

    test('is let go of where the work is no longer being worked', () => {
        const {context} = newContext();
        RunningTaskService.takeByHand('project.a1.p1', newRun());
        mocks.getTask.mockReturnValue({id: 'ship-it', status: 'done'});

        resumeHandWork(context);
        expect(RunningTaskService.takenByHand('project.a1.p1')).toBeUndefined();
        expect(RunningTaskService.getRunningTasks()).toEqual([]);
    });

    test('is let go of where the task is gone from the board altogether', () => {
        const {context} = newContext();
        RunningTaskService.takeByHand('project.a1.p1', newRun());
        mocks.getTask.mockReturnValue(undefined);

        resumeHandWork(context);
        expect(RunningTaskService.takenByHand('project.a1.p1')).toBeUndefined();
    });

    /** A run that took nothing on has nothing to say, and no event to say it in. */
    test('says nothing either way for a loop that took nothing on', () => {
        const {context, fired} = newContext();
        resumeHandWork(context);
        pauseHandWork(context);
        expect(mocks.getTask).not.toHaveBeenCalled();
        expect(runningTaskEvents(fired)).toEqual([]);
    });
});

describe('isRunning', () => {

    test('knows the task a subagent is on', () => {
        start();
        expect(RunningTaskService.isRunning('p1', 'ship-it')).toBe(true);
    });

    test('says no once the run of that task retired', () => {
        RunningTaskService.finish(start());
        expect(RunningTaskService.isRunning('p1', 'ship-it')).toBe(false);
    });

    /** An id is only unique inside its project, and only one project may have that task running. */
    test('tells the same id in another project apart', () => {
        start();
        expect(RunningTaskService.isRunning('p2', 'ship-it')).toBe(false);
        expect(RunningTaskService.isRunning('p1', 'write-tests')).toBe(false);
    });
});
