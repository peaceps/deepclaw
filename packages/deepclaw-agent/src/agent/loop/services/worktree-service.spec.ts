import {describe, expect, test} from 'vitest';
import {WorktreeService} from './worktree-service';

describe('WorktreeService', () => {

    test('hands back the checkout a task was given', () => {
        WorktreeService.remember({projectId: 'p1', taskId: 't1'}, {
            dir: '/data/.projects/p1/worktrees/t1', branch: 'deepclaw/parser-t1',
        });
        expect(WorktreeService.worktreeOf({projectId: 'p1', taskId: 't1'})).toEqual({
            dir: '/data/.projects/p1/worktrees/t1', branch: 'deepclaw/parser-t1',
        });
    });

    test('knows nothing of a task that never asked for one', () => {
        expect(WorktreeService.worktreeOf({projectId: 'p1', taskId: 'nothing'})).toBeUndefined();
    });

    /** Two tasks of one project are the two runs this exists to keep out of each other's files. */
    test('keeps the tasks of one project apart', () => {
        WorktreeService.remember({projectId: 'p2', taskId: 'a'}, {dir: '/wt/a', branch: 'b/a'});
        WorktreeService.remember({projectId: 'p2', taskId: 'b'}, {dir: '/wt/b', branch: 'b/b'});
        expect(WorktreeService.worktreeOf({projectId: 'p2', taskId: 'a'})?.dir).toBe('/wt/a');
        expect(WorktreeService.worktreeOf({projectId: 'p2', taskId: 'b'})?.dir).toBe('/wt/b');
    });

    /** Same task id, another project: nothing of one is the other's. */
    test('keeps one task id of two projects apart', () => {
        WorktreeService.remember({projectId: 'p3', taskId: 'one'}, {dir: '/wt/p3', branch: 'b/3'});
        expect(WorktreeService.worktreeOf({projectId: 'p4', taskId: 'one'})).toBeUndefined();
    });
});
