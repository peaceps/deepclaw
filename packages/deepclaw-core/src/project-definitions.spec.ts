import {describe, expect, test} from 'vitest';
import {
    getProjectProgress, getProjectStatus, getTaskProgress, slimProject, slimProjectRow,
    type Project, type Task
} from './project-definitions';

function newTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'task',
        title: 'task',
        description: '',
        status: 'todo',
        priority: 'medium',
        blockedBy: [],
        blocks: [],
        ...overrides,
    };
}

function newProject(overrides: Partial<Project> = {}): Project {
    return {
        id: 'p1',
        title: 'project',
        description: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        creator: 'a1',
        priority: 'medium',
        tasks: {},
        completedTasks: [],
        ongoingTasks: [],
        canStartTasks: [],
        ...overrides,
    };
}

describe('getProjectStatus', () => {

    test('is done once the project is closed', () => {
        expect(getProjectStatus(newProject({closedAt: '2026-01-02T00:00:00.000Z'}))).toBe('done');
    });

    test('is done even when tasks are still open', () => {
        const project = newProject({closedAt: '2026-01-02T00:00:00.000Z', ongoingTasks: ['t1']});
        expect(getProjectStatus(project)).toBe('done');
    });

    test('is todo while nothing has started', () => {
        expect(getProjectStatus(newProject())).toBe('todo');
    });

    test('is ongoing once a task is in progress', () => {
        expect(getProjectStatus(newProject({ongoingTasks: ['t1']}))).toBe('ongoing');
    });

    test('is ongoing once a task is completed', () => {
        expect(getProjectStatus(newProject({completedTasks: ['t1']}))).toBe('ongoing');
    });
});

describe('getProjectProgress', () => {

    test('returns null when there is no project', () => {
        expect(getProjectProgress(null)).toBeNull();
        expect(getProjectProgress(undefined)).toBeNull();
    });

    test('returns 0 for a project without tasks', () => {
        expect(getProjectProgress({completedTasks: [], taskCount: 0})).toBe(0);
    });

    test('returns the percentage of done tasks', () => {
        expect(getProjectProgress({completedTasks: ['t1', 't4'], taskCount: 4})).toBe(50);
    });

    test('rounds the percentage', () => {
        expect(getProjectProgress({completedTasks: ['t1'], taskCount: 3})).toBe(33);
    });

    test('returns 100 when every task is done', () => {
        expect(getProjectProgress({completedTasks: ['t1'], taskCount: 1})).toBe(100);
    });

    /** Asked of a project holding no tasks at all, which is how the board holds most of them. */
    test('answers for a project whose tasks were never asked for', () => {
        const project = slimProjectRow(newProject({
            tasks: {t1: newTask({status: 'done'}), t2: newTask()},
            completedTasks: ['t1'],
        }));
        expect(project.tasks).toBeUndefined();
        expect(getProjectProgress(project)).toBe(50);
    });
});

describe('slimProject', () => {

    test('counts the tasks and keeps them', () => {
        const project = slimProject(newProject({
            tasks: {t1: newTask(), t2: newTask({id: 't2'})},
        }));
        expect(project.taskCount).toBe(2);
        expect(Object.keys(project.tasks!)).toEqual(['t1', 't2']);
    });

    test('counts none for a project with no tasks', () => {
        expect(slimProject(newProject()).taskCount).toBe(0);
    });
});

describe('slimProjectRow', () => {

    /** The count is what is left of the tasks, and the one thing nothing else could say. */
    test('counts the tasks and leaves them behind', () => {
        const project = slimProjectRow(newProject({
            tasks: {t1: newTask(), t2: newTask({id: 't2'})},
        }));
        expect(project.taskCount).toBe(2);
        expect(project.tasks).toBeUndefined();
        expect('tasks' in project).toBe(false);
    });

    test('keeps everything the project itself said', () => {
        const project = slimProjectRow(newProject({
            title: 'Ship it', tags: ['urgent'], ongoingTasks: ['t1'], completedTasks: ['t2'],
        }));
        expect(project).toEqual(expect.objectContaining({
            id: 'p1', title: 'Ship it', tags: ['urgent'], ongoingTasks: ['t1'],
            completedTasks: ['t2'], taskCount: 0,
        }));
    });
});

describe('getTaskProgress', () => {

    test('returns null unless the task is ongoing', () => {
        const steps = {steps: ['a', 'b'], currentStepIndex: 1};
        expect(getTaskProgress(newTask({status: 'todo', stepsStatus: steps}))).toBeNull();
        expect(getTaskProgress(newTask({status: 'done', stepsStatus: steps}))).toBeNull();
    });

    test('returns null when the ongoing task has no steps', () => {
        expect(getTaskProgress(newTask({status: 'ongoing'}))).toBeNull();
        expect(getTaskProgress(newTask({
            status: 'ongoing', stepsStatus: {steps: [], currentStepIndex: 0}
        }))).toBeNull();
    });

    test('returns 0 while the step index is still negative', () => {
        expect(getTaskProgress(newTask({
            status: 'ongoing', stepsStatus: {steps: ['a', 'b'], currentStepIndex: -1}
        }))).toBe(0);
    });

    test('reports progress from the current step index', () => {
        expect(getTaskProgress(newTask({
            status: 'ongoing', stepsStatus: {steps: ['a', 'b', 'c', 'd'], currentStepIndex: 1}
        }))).toBe(25);
    });

    test('rounds the percentage', () => {
        expect(getTaskProgress(newTask({
            status: 'ongoing', stepsStatus: {steps: ['a', 'b', 'c'], currentStepIndex: 2}
        }))).toBe(67);
    });
});
