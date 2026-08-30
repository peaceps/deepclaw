import {afterEach, describe, expect, test} from 'vitest';
import {type RunningTask} from '@deepclaw/core';
import {RunningTaskService} from './running-task-service';

/** The service is a singleton, so whatever a test started has to be retired after it. */
const started: string[] = [];

function start(overrides: Partial<RunningTask> = {}): string {
    const runId = RunningTaskService.startTaskLoopRun(newRun(overrides));
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
    started.splice(0).forEach(runId => RunningTaskService.finishTaskLoopRun(runId));
    ['project.a1.p1', 'project.a2.p1'].forEach(loopId => RunningTaskService.endMainLoopRun(loopId));
});

describe('RunningTaskService', () => {

    test('has nothing running before anything started', () => {
        expect(RunningTaskService.getRunningTasks()).toEqual([]);
    });

    test('lists a run from the moment it started until it finished', () => {
        const runId = start();
        expect(RunningTaskService.getRunningTasks()).toEqual([{...newRun(), runId}]);
        RunningTaskService.finishTaskLoopRun(runId);
        expect(RunningTaskService.getRunningTasks()).toEqual([]);
    });

    test('keeps the runs of several subagents apart', () => {
        const first = start();
        const second = start({taskId: 'write-tests', agentId: 'a2'});
        RunningTaskService.finishTaskLoopRun(first);
        expect(RunningTaskService.getRunningTasks())
            .toEqual([{...newRun({taskId: 'write-tests', agentId: 'a2'}), runId: second}]);
    });

    /** Two runs of one task are told apart by their handle, never by what they point at. */
    test('retires only the run that finished when one task runs twice', () => {
        const first = start();
        const second = start({startedAt: '2026-08-13T08:00:00.000Z'});
        RunningTaskService.finishTaskLoopRun(first);
        expect(RunningTaskService.getRunningTasks())
            .toEqual([{...newRun({startedAt: '2026-08-13T08:00:00.000Z'}), runId: second}]);
    });

    test('gives every run a handle of its own', () => {
        expect(start()).not.toBe(start());
    });

    test('ignores a handle that was already retired', () => {
        const runId = start();
        RunningTaskService.finishTaskLoopRun(runId);
        RunningTaskService.finishTaskLoopRun(runId);
        expect(RunningTaskService.getRunningTasks()).toEqual([]);
    });
});

/**
 * A main loop working a task itself is working it for the turn it said so in: the word is good
 * until that turn ends, and a turn always ends, so nothing here is left behind by a loop that went
 * on to talk about something else.
 */
describe('a task a main loop works itself', () => {

    test('runs from the moment the loop says it is working it', () => {
        RunningTaskService.startMainLoopRun('project.a1.p1', newRun());
        expect(RunningTaskService.getRunningTasks())
            .toEqual([{...newRun(), runId: expect.any(String)}]);
        expect(RunningTaskService.isRunning('p1', 'ship-it')).toBe(true);
    });

    /** The browsers tell the rows of their list apart by it, and this is one row of work. */
    test('is the same run to the browsers however often the loop says it', () => {
        RunningTaskService.startMainLoopRun('project.a1.p1', newRun());
        const [first] = RunningTaskService.getRunningTasks();
        RunningTaskService.startMainLoopRun('project.a1.p1', newRun());
        expect(RunningTaskService.getRunningTasks()).toEqual([first]);
    });

    test('is over when the turn is', () => {
        RunningTaskService.startMainLoopRun('project.a1.p1', newRun());
        expect(RunningTaskService.endMainLoopRun('project.a1.p1')).toBe(true);
        expect(RunningTaskService.getRunningTasks()).toEqual([]);
        expect(RunningTaskService.isRunning('p1', 'ship-it')).toBe(false);
    });

    /** What the turn of a loop that said nothing ends is nothing, and there is nothing to announce. */
    test('has nothing to end for a loop that took nothing on', () => {
        expect(RunningTaskService.endMainLoopRun('project.a1.p1')).toBe(false);
    });

    /** One task at a time: a loop is answering one turn, and the last word of it is where it is. */
    test('leaves nothing behind when the loop moves to another task', () => {
        RunningTaskService.startMainLoopRun('project.a1.p1', newRun());
        RunningTaskService.startMainLoopRun('project.a1.p1', newRun({taskId: 'write-tests'}));
        expect(RunningTaskService.getRunningTasks())
            .toEqual([{...newRun({taskId: 'write-tests'}), runId: expect.any(String)}]);
    });

    test('keeps what two loops are working apart', () => {
        RunningTaskService.startMainLoopRun('project.a1.p1', newRun());
        RunningTaskService.startMainLoopRun('project.a2.p1', newRun({taskId: 'write-tests', agentId: 'a2'}));
        RunningTaskService.endMainLoopRun('project.a1.p1');
        expect(RunningTaskService.getRunningTasks())
            .toEqual([{...newRun({taskId: 'write-tests', agentId: 'a2'}), runId: expect.any(String)}]);
    });

    /** Both of them are working it, and each of them goes when its own turn ends. */
    test('stands for every loop that says it is on one task', () => {
        RunningTaskService.startMainLoopRun('project.a1.p1', newRun());
        RunningTaskService.startMainLoopRun('project.a2.p1', newRun({agentId: 'a2'}));
        expect(RunningTaskService.getRunningTasks()).toEqual([
            {...newRun(), runId: 'project.a1.p1'},
            {...newRun({agentId: 'a2'}), runId: 'project.a2.p1'},
        ]);
        expect(RunningTaskService.endMainLoopRun('project.a1.p1')).toBe(true);
        expect(RunningTaskService.isRunning('p1', 'ship-it')).toBe(true);
        expect(RunningTaskService.endMainLoopRun('project.a2.p1')).toBe(true);
        expect(RunningTaskService.isRunning('p1', 'ship-it')).toBe(false);
    });

    test('is let go of where the loop hands the task on after all', () => {
        RunningTaskService.startMainLoopRun('project.a1.p1', newRun());
        expect(RunningTaskService.dropMainLoopRun('project.a1.p1', 'p1', 'ship-it')).toBe(true);
        expect(RunningTaskService.getRunningTasks()).toEqual([]);
        expect(RunningTaskService.dropMainLoopRun('project.a1.p1', 'p1', 'ship-it')).toBe(false);
    });

    /** What another loop says of itself is true until its own turn ends, and no third party's to take back. */
    test('leaves what another loop said it is working alone', () => {
        RunningTaskService.startMainLoopRun('project.a2.p1', newRun({agentId: 'a2'}));
        expect(RunningTaskService.dropMainLoopRun('project.a1.p1', 'p1', 'ship-it')).toBe(false);
        expect(RunningTaskService.getRunningTasks())
            .toEqual([{...newRun({agentId: 'a2'}), runId: 'project.a2.p1'}]);
    });

    /** A loop that took up something else has said nothing about the task being handed on. */
    test('leaves the loop on the task it did take up', () => {
        RunningTaskService.startMainLoopRun('project.a1.p1', newRun({taskId: 'write-tests'}));
        expect(RunningTaskService.dropMainLoopRun('project.a1.p1', 'p1', 'ship-it')).toBe(false);
        expect(RunningTaskService.getRunningTasks())
            .toEqual([{...newRun({taskId: 'write-tests'}), runId: 'project.a1.p1'}]);
    });

    /** The run of a subagent is nobody's to end from here, whichever end this is asked from. */
    test('leaves the run of a subagent alone', () => {
        start();
        RunningTaskService.startMainLoopRun('project.a1.p1', newRun({taskId: 'write-tests'}));
        RunningTaskService.endMainLoopRun('project.a1.p1');
        RunningTaskService.dropMainLoopRun('project.a1.p1', 'p1', 'ship-it');
        expect(RunningTaskService.getRunningTasks()).toEqual([{...newRun(), runId: expect.any(String)}]);
    });
});

describe('isRunning', () => {

    test('knows the task a subagent is on', () => {
        start();
        expect(RunningTaskService.isRunning('p1', 'ship-it')).toBe(true);
    });

    test('says no once the run of that task retired', () => {
        RunningTaskService.finishTaskLoopRun(start());
        expect(RunningTaskService.isRunning('p1', 'ship-it')).toBe(false);
    });

    /** An id is only unique inside its project, and only one project may have that task running. */
    test('tells the same id in another project apart', () => {
        start();
        expect(RunningTaskService.isRunning('p2', 'ship-it')).toBe(false);
        expect(RunningTaskService.isRunning('p1', 'write-tests')).toBe(false);
    });

    test('tells the same id in another project apart for work done by hand', () => {
        RunningTaskService.startMainLoopRun('project.a1.p1', newRun());
        expect(RunningTaskService.isRunning('p2', 'ship-it')).toBe(false);
    });
});

/** The narrower question, asked where the answer decides whether a task can be handed out. */
describe('isTaskLoopRunning', () => {

    test('knows the task a subagent is on', () => {
        start();
        expect(RunningTaskService.isTaskLoopRunning('p1', 'ship-it')).toBe(true);
    });

    test('says no of a task a main loop is working itself', () => {
        RunningTaskService.startMainLoopRun('project.a1.p1', newRun());
        expect(RunningTaskService.isTaskLoopRunning('p1', 'ship-it')).toBe(false);
        expect(RunningTaskService.isRunning('p1', 'ship-it')).toBe(true);
    });
});
