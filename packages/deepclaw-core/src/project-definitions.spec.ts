import {describe, expect, test} from 'vitest';
import {
    getProjectProgress, getProjectStatus, getTaskProgress,
    type Project, type Task
} from './project-definitions';

function newTask(overrides: Partial<Task> = {}): Task {
    return {
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
        expect(getProjectProgress(newProject())).toBe(0);
    });

    test('returns the percentage of done tasks', () => {
        const project = newProject({tasks: {
            t1: newTask({status: 'done'}),
            t2: newTask({status: 'ongoing'}),
            t3: newTask({status: 'todo'}),
            t4: newTask({status: 'done'}),
        }});
        expect(getProjectProgress(project)).toBe(50);
    });

    test('rounds the percentage', () => {
        const project = newProject({tasks: {
            t1: newTask({status: 'done'}),
            t2: newTask(),
            t3: newTask(),
        }});
        expect(getProjectProgress(project)).toBe(33);
    });

    test('returns 100 when every task is done', () => {
        const project = newProject({tasks: {t1: newTask({status: 'done'})}});
        expect(getProjectProgress(project)).toBe(100);
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
