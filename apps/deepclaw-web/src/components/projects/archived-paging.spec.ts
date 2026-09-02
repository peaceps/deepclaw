import {describe, expect, test} from 'vitest';
import type {ArchivedProjectsPage, SlimProject} from '@deepclaw/core';
import {withNextPage, withoutProject} from './archived-paging';

function row(id: string, creator = 'a1'): SlimProject {
    return {
        id,
        title: `Project ${id}`,
        description: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        creator,
        priority: 'medium',
        completedTasks: [],
        ongoingTasks: [],
        canStartTasks: [],
        taskCount: 0,
    };
}

function idsOf(projects: SlimProject[]): string[] {
    return projects.map(project => project.id);
}

describe('withNextPage', () => {

    test('puts the page that landed after the rows in hand', () => {
        expect(idsOf(withNextPage([row('p1')], [row('p2'), row('p3')])))
            .toEqual(['p1', 'p2', 'p3']);
    });

    test('starts a list off with the first page', () => {
        expect(idsOf(withNextPage([], [row('p1')]))).toEqual(['p1']);
    });

    test('reads a page with nothing in it as the end of the archive', () => {
        expect(idsOf(withNextPage([row('p1')], []))).toEqual(['p1']);
    });

    /**
     * A project put away while the window is open shifts every page after it along by one, and the
     * row at the seam is asked for twice. Two rows under one key is what that would come to.
     */
    test('leaves out a project the shifted page brought a second time', () => {
        expect(idsOf(withNextPage([row('p1'), row('p2')], [row('p2'), row('p3')])))
            .toEqual(['p1', 'p2', 'p3']);
    });

    /** The one on the screen stays the one on the screen. */
    test('keeps the row in hand rather than the copy that landed', () => {
        const held = row('p1');
        expect(withNextPage([held], [{...row('p1'), title: 'Renamed'}])).toEqual([held]);
    });
});

describe('withoutProject', () => {

    function page(projects: SlimProject[], total = projects.length): ArchivedProjectsPage {
        const owners = new Map<string, number>();
        for (const project of projects) {
            owners.set(project.creator, (owners.get(project.creator) ?? 0) + 1);
        }
        return {
            projects,
            owners: [...owners].map(([id, count]) => ({id, count})),
            total,
        };
    }

    test('takes the row off the list', () => {
        const left = withoutProject(page([row('p1'), row('p2')]), 'p1');
        expect(idsOf(left.projects)).toEqual(['p2']);
    });

    /** What says whether there is another page to ask for, and there is one project less to read. */
    test('counts one less to read', () => {
        expect(withoutProject(page([row('p1')], 30), 'p1').total).toBe(29);
    });

    test('counts one less against the name that wrote it', () => {
        const left = withoutProject(page([row('p1', 'a1'), row('p2', 'a1'), row('p3', 'a2')]), 'p1');
        expect(left.owners).toEqual([{id: 'a1', count: 1}, {id: 'a2', count: 1}]);
    });

    /** A name with nothing left in the archive is nothing to pick the archive out by. */
    test('drops a name whose last project has gone', () => {
        const left = withoutProject(page([row('p1', 'a1'), row('p2', 'a2')]), 'p1');
        expect(left.owners).toEqual([{id: 'a2', count: 1}]);
    });

    /** Two windows on the same archive, and the row this one is being told of already left that one. */
    test('leaves a page that never held the project alone', () => {
        const held = page([row('p1')], 30);
        expect(withoutProject(held, 'gone')).toBe(held);
    });
});

/**
 * The window's half of the seam the manager's own spec pins from the other side. A row put back or
 * thrown away leaves the list in hand and the archive behind it at the same moment, and what comes
 * next is asked for by how many rows are left in hand: both of them shortening together is the whole
 * of why that offset still points where the reader has got to.
 */
describe('reading on after a row has left', () => {

    const PAGE = 10;

    /** An archive that answers a page from wherever it is asked, and loses a row when one leaves. */
    function archive(ids: string[]) {
        let held = [...ids];
        return {
            gone: (id: string) => {
                held = held.filter(one => one !== id);
            },
            page: (offset: number): ArchivedProjectsPage => ({
                projects: held.slice(offset, offset + PAGE).map(id => row(id)),
                owners: [],
                total: held.length,
            }),
        };
    }

    /** Page after page, each asked for by how many rows are in hand, to the end of the archive. */
    function readOn(
        shelf: ReturnType<typeof archive>, inHand: ArchivedProjectsPage
    ): ArchivedProjectsPage {
        while (inHand.projects.length < inHand.total) {
            const landed = shelf.page(inHand.projects.length);
            inHand = {...landed, projects: withNextPage(inHand.projects, landed.projects)};
        }
        return inHand;
    }

    /** The window as it stands with its first page read and one row of it sent away. */
    function afterOneLeft(shelf: ReturnType<typeof archive>, gone: string): ArchivedProjectsPage {
        const first = shelf.page(0);
        shelf.gone(gone);
        return withoutProject(first, gone);
    }

    const ids = [...Array(25).keys()].map(index => `p${index}`);

    /** Nothing having left yet, so that what the tests below say is about the row that leaves. */
    test('reads every project once and in order', () => {
        const shelf = archive(ids);
        expect(idsOf(readOn(shelf, shelf.page(0)).projects)).toEqual(ids);
    });

    test('reads on from where the rows in hand end after one left', () => {
        const shelf = archive(ids);
        const inHand = afterOneLeft(shelf, 'p3');
        expect(idsOf(readOn(shelf, inHand).projects)).toEqual(ids.filter(id => id !== 'p3'));
    });

    /** The last row of the page in hand: the one a list shortened on one side only would step over. */
    test('reads on when the row at the seam is the one that left', () => {
        const shelf = archive(ids);
        const seam = `p${PAGE - 1}`;
        const inHand = afterOneLeft(shelf, seam);
        expect(idsOf(readOn(shelf, inHand).projects)).toEqual(ids.filter(id => id !== seam));
    });
});
