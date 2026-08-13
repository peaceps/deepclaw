import {afterEach, describe, expect, test} from 'vitest';
import {type RunningTask} from '@deepclaw/core';
import {RunningTaskService} from './running-task-service';

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
        taskTitle: 'ship it',
        agentId: 'a1',
        startedAt: '2026-08-13T07:00:00.000Z',
        ...overrides,
    };
}

afterEach(() => {
    started.splice(0).forEach(runId => RunningTaskService.finish(runId));
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
        const second = start({taskTitle: 'write tests', agentId: 'a2'});
        RunningTaskService.finish(first);
        expect(RunningTaskService.getRunningTasks())
            .toEqual([{...newRun({taskTitle: 'write tests', agentId: 'a2'}), runId: second}]);
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

describe('isRunning', () => {

    test('knows the task a subagent is on', () => {
        start();
        expect(RunningTaskService.isRunning('p1', 'ship it')).toBe(true);
    });

    test('says no once the run of that task retired', () => {
        RunningTaskService.finish(start());
        expect(RunningTaskService.isRunning('p1', 'ship it')).toBe(false);
    });

    /** Two projects are free to name a task the same, and only one of them may be running. */
    test('tells the same title in another project apart', () => {
        start();
        expect(RunningTaskService.isRunning('p2', 'ship it')).toBe(false);
        expect(RunningTaskService.isRunning('p1', 'write tests')).toBe(false);
    });
});
