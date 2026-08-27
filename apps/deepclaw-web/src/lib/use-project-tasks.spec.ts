import {describe, expect, test, vi} from 'vitest';
import type {SlimProject, Task} from '@deepclaw/core';
import {idsWantingTasks, landingOfAnswer} from './use-project-tasks';

/**
 * The asking itself is React's to run and there is no renderer here: what is tested is what the
 * hook decides, which is the asking of a project and the writing of the answer. Reading the module
 * pulls in the server it asks, and reading that pulls in the whole of the agent behind it.
 */
vi.mock('@/server/data', () => ({getProjectDetail: vi.fn()}));

function newTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'write-tests',
        title: 'write tests',
        description: 'cover the deciding',
        status: 'todo',
        priority: 'medium',
        blockedBy: [],
        blocks: [],
        ...overrides,
    };
}

type Row = Pick<SlimProject, 'id' | 'tasks'>;

/** A project as it reaches the page in the list, which is to say without any of its tasks. */
function row(id: string): Row {
    return {id};
}

/** The same, once it has been asked about and answered. */
function rowWithTasks(id: string): Row {
    return {id, tasks: {'write-tests': newTask()}};
}

describe('idsWantingTasks', () => {

    test('wants the tasks of a project that arrived without them', () => {
        expect(idsWantingTasks([row('p1')], ['p1'])).toBe('p1');
    });

    test('wants nothing of a project whose tasks are in hand', () => {
        expect(idsWantingTasks([rowWithTasks('p1')], ['p1'])).toBe('');
    });

    /** Some projects have no tasks, and one of those has been answered about like any other. */
    test('wants nothing of a project answered about as having no tasks', () => {
        expect(idsWantingTasks([{id: 'p1', tasks: {}}], ['p1'])).toBe('');
    });

    /** The agent page names the project of a run, which no row of the board need be drawn from. */
    test('wants the tasks of a project the store has never heard of', () => {
        expect(idsWantingTasks([rowWithTasks('p1')], ['p2'])).toBe('p2');
    });

    test('wants nothing of the projects it was not asked about', () => {
        expect(idsWantingTasks([row('p1'), row('p2')], ['p2'])).toBe('p2');
    });

    /**
     * A stream coming back reads the whole list again, and a list carries no tasks: whatever was
     * drawing them is left wanting them, which is how they come to be asked for as they now stand.
     */
    test('wants them all again where the whole list has been put there anew', () => {
        expect(idsWantingTasks([row('p1'), row('p2')], ['p1', 'p2'])).toBe('p1,p2');
    });

    /**
     * Read again on every change to anything the store holds, and answering in an array would be
     * answering in a new one each time, which reads as a new set of projects and asks afresh.
     */
    test('answers in something that compares by value', () => {
        expect(idsWantingTasks([row('p1')], ['p1'])).toBe(idsWantingTasks([row('p1')], ['p1']));
    });
});

describe('landingOfAnswer', () => {

    test('writes an answer about a project still in the list', () => {
        expect(landingOfAnswer({
            epochAtAsk: 1, epochNow: 1, knownAtAsk: true, knownNow: true,
        })).toBe('write');
    });

    /** The agent page asks about projects no row holds, and those are the page's to be told of. */
    test('writes an answer about a project the list never had', () => {
        expect(landingOfAnswer({
            epochAtAsk: 1, epochNow: 1, knownAtAsk: false, knownNow: false,
        })).toBe('write');
    });

    /**
     * The project was put away while this was out, and the answer was read while it was still
     * there: written, it would put the row back with nothing left to take it off again.
     */
    test('drops an answer about a project that has left the list since', () => {
        expect(landingOfAnswer({
            epochAtAsk: 1, epochNow: 1, knownAtAsk: true, knownNow: false,
        })).toBe('drop');
    });

    /**
     * The whole list has been put there anew since, so this speaks of the list that is gone, which
     * after an outage is older than it by everything that happened during it.
     */
    test('ignores an answer asked for before the whole was replaced', () => {
        expect(landingOfAnswer({
            epochAtAsk: 1, epochNow: 2, knownAtAsk: true, knownNow: true,
        })).toBe('ignore');
    });

    /**
     * Ignored rather than dropped, the difference being the asks held as in the air: those belong
     * to the run that has ended and are let go of whole, not reached into by id.
     */
    test('ignores it over dropping it where the project has also left the list', () => {
        expect(landingOfAnswer({
            epochAtAsk: 1, epochNow: 2, knownAtAsk: true, knownNow: false,
        })).toBe('ignore');
    });
});
