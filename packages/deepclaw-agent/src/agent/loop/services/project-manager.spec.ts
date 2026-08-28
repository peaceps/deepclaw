import {beforeEach, describe, expect, test, vi} from 'vitest';
import {PROJECT_CONFIG, type Project, type Task} from '@deepclaw/core';

const mocks = vi.hoisted(() => ({
    readDir: vi.fn<(dir: string) => Record<string, {dir: string; content: string}>>(() => ({})),
    writeFile: vi.fn<(path: string, content: string) => string>((path: string) => path),
    exists: vi.fn<(path: string) => boolean>(() => false),
    hashString: vi.fn<(text: string) => string>(() => 'hash'),
    movePath: vi.fn<(from: string, to: string) => boolean>(() => true),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {
        readDir: mocks.readDir,
        writeFile: mocks.writeFile,
        exists: mocks.exists,
        hashString: mocks.hashString,
        movePath: mocks.movePath,
    },
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    getLoopLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

type ProjectManagerType = (typeof import('./project-manager'))['ProjectManager'];

/** The manager keeps every project in a static map, so each test gets a freshly imported class. */
async function loadManager(files: Record<string, {dir: string; content: string}> = {}): Promise<ProjectManagerType> {
    vi.clearAllMocks();
    mocks.readDir.mockReturnValue(files);
    mocks.writeFile.mockImplementation((path: string) => path);
    mocks.exists.mockReturnValue(false);
    mocks.movePath.mockReturnValue(true);
    vi.resetModules();
    return (await import('./project-manager')).ProjectManager;
}

/** Pays the transform of the module graph while the file loads, out of reach of a test timeout. */
await loadManager();

/** Names a task after its title, so a test that says "design" reaches it either way. */
function newTask(
    manager: ProjectManagerType, title: string,
    extra: {id?: string; steps?: string[]; blockedBy?: string[]; assignee?: string} = {}
): Task {
    return manager.createTask({
        agentId: 'a1', id: title, title, description: `${title} description`, priority: 'low', ...extra
    });
}

function newSteps(count: number): string[] {
    return [...Array(count).keys()].map(index => `step ${index}`);
}

/** A project as it lies while its plan is still being talked over: no task of it may move yet. */
function newPlannedProject(manager: ProjectManagerType, tasks: Task[]): Project {
    return manager.createProject(
        {agentId: 'a1', title: 'Ship it', description: 'ship the thing', priority: 'high'}, tasks
    );
}

/** A project the user has set going, which is what a test of the work itself wants. */
function newProject(manager: ProjectManagerType, tasks: Task[]): Project {
    return manager.startProject(newPlannedProject(manager, tasks).id);
}

/** A project as it lies on disk, whose tasks may well be older than the fields a task has today. */
function storedProject(
    overrides: Partial<Omit<Project, 'tasks'>> & {tasks?: Record<string, unknown>} = {}
): string {
    return JSON.stringify({
        id: 'p-stored',
        title: 'Stored',
        description: 'from disk',
        createdAt: '2024-01-01T00:00:00.000Z',
        creator: 'a1',
        priority: 'high',
        tasks: {},
        completedTasks: [],
        ongoingTasks: [],
        canStartTasks: [],
        ...overrides,
    });
}

describe('loadProjects at import time', () => {

    test('reads nothing when the project folder is empty', async () => {
        const manager = await loadManager();
        expect(manager.getProjectList(true)).toEqual({projects: {open: [], closed: []}});
    });

    test('loads a project from disk and keeps its id', async () => {
        const manager = await loadManager({p1: {dir: '.projects/p1', content: storedProject()}});
        expect(manager.getProjectDetail('p-stored').title).toBe('Stored');
    });

    test('defaults a missing priority to low', async () => {
        const manager = await loadManager({
            p1: {dir: '.projects/p1', content: storedProject({priority: undefined})},
        });
        expect(manager.getProjectDetail('p-stored').priority).toBe('low');
    });

    test('recomputes the task buckets of a loaded project', async () => {
        const manager = await loadManager({p1: {dir: '.projects/p1', content: storedProject({
            tasks: {
                done: {title: 'done', description: 'd', status: 'done', priority: 'low', blockedBy: [], blocks: []},
                next: {title: 'next', description: 'd', status: 'todo', priority: 'low', blockedBy: ['done'], blocks: []},
            },
            completedTasks: ['stale'],
        })}});
        const project = manager.getProjectDetail('p-stored');
        expect(project.completedTasks).toEqual(['done']);
        expect(project.canStartTasks).toEqual(['next']);
    });

    /**
     * A file written before tasks had an id was keyed by the title and pointed at tasks by it, so
     * reading the key as the id leaves every reference in it standing.
     */
    test('takes the key as the id of a task that was stored without one', async () => {
        const manager = await loadManager({p1: {dir: '.projects/p1', content: storedProject({
            tasks: {
                design: {title: 'design', description: 'd', status: 'done', priority: 'low', blockedBy: [], blocks: ['build']},
                build: {title: 'build', description: 'd', status: 'todo', priority: 'low', blockedBy: ['design'], blocks: []},
            },
        })}});
        const project = manager.getProjectDetail('p-stored');
        expect(project.tasks['design']!.id).toBe('design');
        expect(project.canStartTasks).toEqual(['build']);
        expect(manager.getTask('p-stored', 'build')!.title).toBe('build');
    });

    test('leaves the id of a task that carries one alone', async () => {
        const manager = await loadManager({p1: {dir: '.projects/p1', content: storedProject({
            tasks: {
                t1: {id: 't1', title: 'design', description: 'd', status: 'todo', priority: 'low', blockedBy: [], blocks: []},
            },
        })}});
        expect(manager.getProjectDetail('p-stored').tasks['t1']!.id).toBe('t1');
    });

    /**
     * A project written before there was a button to start one carries no date, and the work in it
     * is all there is to go by. Left undated, it would be a project in full flight that no further
     * task could be handed to, and one the board offered to start over again.
     */
    test('dates a project stored with work already in it as one that was started', async () => {
        const manager = await loadManager({p1: {dir: '.projects/p1', content: storedProject({
            tasks: {
                design: {title: 'design', description: 'd', status: 'ongoing', priority: 'low', blockedBy: [], blocks: []},
            },
        })}});
        expect(manager.getProjectDetail('p-stored').startedAt).toBe('2024-01-01T00:00:00.000Z');
    });

    test('dates a project stored with work already finished in it', async () => {
        const manager = await loadManager({p1: {dir: '.projects/p1', content: storedProject({
            tasks: {
                design: {title: 'design', description: 'd', status: 'done', priority: 'low', blockedBy: [], blocks: []},
            },
        })}});
        expect(manager.getProjectDetail('p-stored').startedAt).toBe('2024-01-01T00:00:00.000Z');
    });

    /** A plan nobody has worked yet is a plan, whether it was written before the date or after. */
    test('leaves a project stored with nothing but a plan in it unstarted', async () => {
        const manager = await loadManager({p1: {dir: '.projects/p1', content: storedProject({
            tasks: {
                design: {title: 'design', description: 'd', status: 'todo', priority: 'low', blockedBy: [], blocks: []},
            },
        })}});
        expect(manager.getProjectDetail('p-stored').startedAt).toBeUndefined();
    });

    test('stands by the date a started project was stored with', async () => {
        const manager = await loadManager({p1: {dir: '.projects/p1', content: storedProject({
            startedAt: '2025-05-05T00:00:00.000Z',
            tasks: {
                design: {title: 'design', description: 'd', status: 'ongoing', priority: 'low', blockedBy: [], blocks: []},
            },
        })}});
        expect(manager.getProjectDetail('p-stored').startedAt).toBe('2025-05-05T00:00:00.000Z');
    });

    /**
     * Lying in the live folder is what says a project was not put away, so a date found there is one
     * the folder has outlived: a project moved back by hand, or one an interrupted archive left with
     * the date written and the move undone.
     */
    test('reads a project in the live folder as one that was never put away', async () => {
        const manager = await loadManager({p1: {dir: '.projects/p1', content: storedProject({
            archivedAt: '2024-02-02T00:00:00.000Z',
        })}});
        expect(manager.getProjectDetail('p-stored').archivedAt).toBeUndefined();
        expect(manager.getProjectList(true).projects.open)
            .toEqual([{id: 'p-stored', title: 'Stored', description: 'from disk'}]);
    });

    test('skips a file that is not valid json', async () => {
        const manager = await loadManager({p1: {dir: '.projects/p1', content: '{not json'}});
        expect(manager.getProjectList(true).projects.open).toEqual([]);
    });

    test('skips a project without a title', async () => {
        const manager = await loadManager({p1: {dir: '.projects/p1', content: storedProject({title: ''})}});
        expect(manager.getProjectList(true).projects.open).toEqual([]);
    });

    test('reads a project whose file has no tasks map as a project without tasks', async () => {
        const content = JSON.stringify({id: 'p-stored', title: 'Stored', description: 'from disk'});
        const manager = await loadManager({p1: {dir: '.projects/p1', content}});
        expect(manager.getProjectList(true).projects.open).toEqual([
            {id: 'p-stored', title: 'Stored', description: 'from disk'},
        ]);
        expect(manager.getProjectDetail('p-stored').tasks).toEqual({});
    });
});

describe('createTask', () => {

    let manager: ProjectManagerType;

    beforeEach(async () => {
        manager = await loadManager();
    });

    test('creates a todo task assigned to the given agent', () => {
        expect(newTask(manager, 'write')).toEqual({
            id: 'write',
            title: 'write',
            description: 'write description',
            priority: 'low',
            status: 'todo',
            assignee: 'a1',
            blockedBy: [],
            blocks: [],
            stepsStatus: undefined,
        });
    });

    /** Planning a task is not working on it: it falls to whoever it was handed to. */
    test('assigns the task to the named agent instead of the one creating it', () => {
        expect(newTask(manager, 'write', {assignee: 'a2'}).assignee).toBe('a2');
    });

    test('keeps the given steps with no step started yet', () => {
        expect(newTask(manager, 'write', {steps: ['one', 'two']}).stepsStatus)
            .toEqual({steps: ['one', 'two'], currentStepIndex: -1});
    });

    test('leaves the steps status out when the step list is empty', () => {
        expect(newTask(manager, 'write', {steps: []}).stepsStatus).toBeUndefined();
    });

    test('keeps the declared blocking tasks', () => {
        expect(newTask(manager, 'write', {blockedBy: ['design']}).blockedBy).toEqual(['design']);
    });

    test('rejects more steps than the limit allows', () => {
        expect(() => newTask(manager, 'write', {steps: newSteps(PROJECT_CONFIG.maxTaskStepsCount + 1)}))
            .toThrow('Too much steps for a task. Max is 8.');
    });

    test('accepts exactly the maximum number of steps', () => {
        const steps = newSteps(PROJECT_CONFIG.maxTaskStepsCount);
        expect(newTask(manager, 'write', {steps}).stepsStatus?.steps).toHaveLength(8);
    });
});

describe('createProject', () => {

    let manager: ProjectManagerType;

    beforeEach(async () => {
        manager = await loadManager();
    });

    test('stores the project with a generated id, the creator and a creation time', () => {
        const project = newProject(manager, [newTask(manager, 'design')]);
        expect(project.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(project.creator).toBe('a1');
        expect(project.priority).toBe('high');
        expect(new Date(project.createdAt).toISOString()).toBe(project.createdAt);
        expect(project.closedAt).toBeUndefined();
    });

    test('keys the tasks by id', () => {
        const project = newProject(manager, [
            newTask(manager, 'design', {id: 't1'}), newTask(manager, 'build', {id: 't2'}),
        ]);
        expect(Object.keys(project.tasks)).toEqual(['t1', 't2']);
    });

    /** Two tasks may well read the same on the board, only the handle on them has to differ. */
    test('accepts two tasks with the same title under ids of their own', () => {
        const project = newProject(manager, [
            newTask(manager, 'review', {id: 't1'}), newTask(manager, 'review', {id: 't2'}),
        ]);
        expect(Object.values(project.tasks).map(task => task.title)).toEqual(['review', 'review']);
    });

    test('persists the project as json next to its id', () => {
        const project = newPlannedProject(manager, [newTask(manager, 'design')]);
        expect(mocks.writeFile).toHaveBeenCalledOnce();
        const [path, content] = mocks.writeFile.mock.calls[0]!;
        expect(path).toBe(`.projects/${project.id}/project.json`);
        expect(JSON.parse(content).id).toBe(project.id);
    });

    test('wires blocks as the reverse of blockedBy', () => {
        const project = newProject(manager, [
            newTask(manager, 'design'), newTask(manager, 'build', {blockedBy: ['design']}),
        ]);
        expect(project.tasks['design']!.blocks).toEqual(['build']);
        expect(project.tasks['build']!.blockedBy).toEqual(['design']);
    });

    test('only lets an unblocked task start', () => {
        const project = newProject(manager, [
            newTask(manager, 'design'), newTask(manager, 'build', {blockedBy: ['design']}),
        ]);
        expect(project.canStartTasks).toEqual(['design']);
        expect(project.ongoingTasks).toEqual([]);
        expect(project.completedTasks).toEqual([]);
    });

    test('rejects duplicated task ids', () => {
        expect(() => newProject(manager, [newTask(manager, 'design'), newTask(manager, 'design')]))
            .toThrow('There are duplicated task ids.');
    });

    test('rejects more tasks than the limit allows', () => {
        const tasks = newSteps(PROJECT_CONFIG.maxTasksCount + 1).map(title => newTask(manager, title));
        expect(() => newProject(manager, tasks)).toThrow('There are too many tasks.');
    });

    test('accepts exactly the maximum number of tasks', () => {
        const tasks = newSteps(PROJECT_CONFIG.maxTasksCount).map(title => newTask(manager, title));
        expect(Object.keys(newProject(manager, tasks).tasks)).toHaveLength(20);
    });

    test('rejects a task blocked by a task outside the project', () => {
        expect(() => newProject(manager, [newTask(manager, 'build', {blockedBy: ['ghost']})]))
            .toThrow('Invalid blocked task.');
    });
});

describe('updateProject', () => {

    let manager: ProjectManagerType;

    beforeEach(async () => {
        manager = await loadManager();
    });

    test('merges the given fields into the stored project', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        const updated = manager.updateProject({id, title: 'Renamed', priority: 'urgent'});
        expect(updated.title).toBe('Renamed');
        expect(updated.priority).toBe('urgent');
        expect(manager.getProjectDetail(id).title).toBe('Renamed');
    });

    test('trims, deduplicates, shortens and caps the tags', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        const updated = manager.updateProject({id, tags: [
            '  alpha  ', 'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'x'.repeat(20), '   ',
        ]});
        expect(updated.tags).toEqual(['alpha', 'beta', 'gamma', 'delta', 'epsilon']);
        expect(updated.tags).toHaveLength(PROJECT_CONFIG.maxTagCount);
    });

    /** The plan is theirs to rewrite for as long as it is only a plan. */
    test('replaces the tasks while the project is still todo', () => {
        const {id} = newPlannedProject(manager, [newTask(manager, 'design')]);
        const updated = manager.updateProject({id}, [newTask(manager, 'build')]);
        expect(Object.keys(updated.tasks)).toEqual(['build']);
        expect(updated.canStartTasks).toEqual(['build']);
    });

    /**
     * The plan is what the user agreed to when they set the work going, so it is settled from that
     * moment rather than from the first handover: the two are a second apart, and a list replaced
     * in between is a list they never agreed to.
     */
    test('refuses to replace the tasks once the user started the project', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        expect(() => manager.updateProject({id}, [newTask(manager, 'build')]))
            .toThrow('Only projects in todo state can update tasks.');
    });

    test('refuses to replace the tasks once a task is ongoing', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        expect(() => manager.updateProject({id}, [newTask(manager, 'build')]))
            .toThrow('Only projects in todo state can update tasks.');
    });

    test('still allows updating other fields once a task is ongoing', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        expect(manager.updateProject({id, description: 'new one'}).description).toBe('new one');
    });

    test('persists the project again', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        mocks.writeFile.mockClear();
        manager.updateProject({id, title: 'Renamed'});
        expect(mocks.writeFile).toHaveBeenCalledOnce();
    });

    test('throws for an unknown project id', () => {
        expect(() => manager.updateProject({id: 'ghost'})).toThrow('Project ghost not found.');
    });

    /** Nothing has been done yet, so there is nothing to report on. */
    test('refuses a report while the project has not been started', () => {
        const {id} = newPlannedProject(manager, [newTask(manager, 'design')]);
        expect(() => manager.updateProject({id, output: {type: 'markdown', content: '# done'}}))
            .toThrow('Cannot set output when project is in todo state.');
        expect(manager.getProjectDetail(id).output).toBeUndefined();
    });

    test('keeps a short report on the project', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        const updated = manager.updateProject({id, output: {type: 'markdown', content: '# done'}});
        expect(updated.output).toEqual({type: 'markdown', content: '# done'});
        expect(manager.getProjectDetail(id).output).toEqual({type: 'markdown', content: '# done'});
    });

    /** One report of one project, so the second one of the same kind lands where the first lies. */
    test('files a long report away under a name of the project rather than of a task', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        const content = 'x'.repeat(1501);
        const updated = manager.updateProject({id, output: {type: 'markdown', content}});
        expect(mocks.writeFile).toHaveBeenCalledWith(`.projects/${id}/output/report.md`, content);
        expect(updated.output).toEqual({
            type: 'markdown',
            content: '<Content saved to file>',
            path: `/api/file/projects/${id}/output/report.md`,
        });
        manager.updateProject({id, output: {type: 'markdown', content: 'y'.repeat(1501)}});
        expect(mocks.writeFile).toHaveBeenCalledWith(
            `.projects/${id}/output/report.md`, 'y'.repeat(1501)
        );
    });

    /** The kind of report names the file, so one rewritten as another kind lands beside the old. */
    test('files a report of another kind beside the one it replaces', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        manager.updateProject({id, output: {type: 'markdown', content: 'x'.repeat(1501)}});
        const updated = manager.updateProject({id, output: {type: 'text', content: 'y'.repeat(1501)}});
        expect(mocks.writeFile).toHaveBeenCalledWith(
            `.projects/${id}/output/report.txt`, 'y'.repeat(1501)
        );
        expect(updated.output?.path).toBe(`/api/file/projects/${id}/output/report.txt`);
    });

    /** A closed project is what a report is written about, so writing one may not be refused. */
    test('takes a report after the last task closed the project', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        manager.updateTask(id, {id: 'design', status: 'done'});
        expect(manager.getProjectDetail(id).closedAt).toBeTruthy();
        expect(manager.updateProject({id, output: {type: 'text', content: 'it went well'}}).output)
            .toEqual({type: 'text', content: 'it went well'});
    });
});

describe('updateTask status transitions', () => {

    let manager: ProjectManagerType;

    beforeEach(async () => {
        manager = await loadManager();
    });

    test('moves a task from todo to ongoing', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        const {task, stop} = manager.updateTask(id, {id: 'design', status: 'ongoing'});
        expect(task.status).toBe('ongoing');
        expect(stop).toBe(false);
        expect(manager.getProjectDetail(id).ongoingTasks).toEqual(['design']);
    });

    /**
     * A task leaving todo is work begun, and work begins at the user's word. Held to only where a
     * task is handed to a subagent, this would be a rule a run could walk around: mark the task
     * ongoing first, and the project reads as one at work to everything that asks it that way.
     */
    test('refuses to move a task out of todo before the user started the project', () => {
        const {id} = newPlannedProject(manager, [newTask(manager, 'design')]);
        expect(() => manager.updateTask(id, {id: 'design', status: 'ongoing'}))
            .toThrow('The user has not started this project.');
        expect(manager.getProjectDetail(id).tasks['design']!.status).toBe('todo');
    });

    test('refuses to mark a task done before the user started the project', () => {
        const {id} = newPlannedProject(manager, [newTask(manager, 'design')]);
        expect(() => manager.updateTask(id, {id: 'design', status: 'done'}))
            .toThrow('The user has not started this project.');
    });

    /** The words on a task are read, not worked, so they are the user's to change while they plan. */
    test('takes a rename of a task in a project nobody started yet', () => {
        const {id} = newPlannedProject(manager, [newTask(manager, 'design')]);
        const {task} = manager.updateTask(id, {id: 'design', title: 'design it properly'});
        expect(task.title).toBe('design it properly');
    });

    test('moves a task out of todo once the project is started', () => {
        const {id} = newPlannedProject(manager, [newTask(manager, 'design')]);
        manager.startProject(id);
        expect(manager.updateTask(id, {id: 'design', status: 'ongoing'}).task.status).toBe('ongoing');
    });

    test('marks an ongoing task done with a closing time', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        const {task} = manager.updateTask(id, {id: 'design', status: 'done'});
        expect(task.status).toBe('done');
        expect(new Date(task.closedAt!).toISOString()).toBe(task.closedAt);
        expect(manager.getProjectDetail(id).completedTasks).toEqual(['design']);
    });

    test('rejects a jump straight from todo to done', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        expect(() => manager.updateTask(id, {id: 'design', status: 'done'}))
            .toThrow('You can only update the status from todo to ongoing or from ongoing to done.');
    });

    test('rejects moving an ongoing task back to todo', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        expect(() => manager.updateTask(id, {id: 'design', status: 'todo'}))
            .toThrow('You can only update the status from todo to ongoing or from ongoing to done.');
    });

    test('rejects reopening a done task', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        manager.updateTask(id, {id: 'design', status: 'done'});
        expect(() => manager.updateTask(id, {id: 'design', status: 'ongoing'}))
            .toThrow('You can only update the status from todo to ongoing or from ongoing to done.');
    });

    test('accepts a repeated done update without moving the closing time', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        const closedAt = manager.updateTask(id, {id: 'design', status: 'done'}).task.closedAt;
        expect(manager.updateTask(id, {id: 'design', status: 'done'}).task.closedAt).toBe(closedAt);
    });

    /** The whole point of the id: the words on a task are the user's to change, whenever. */
    test('renames an ongoing task without losing anything that points at it', () => {
        const {id} = newProject(manager, [
            newTask(manager, 'design'), newTask(manager, 'build', {blockedBy: ['design']}),
        ]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        const {task} = manager.updateTask(id, {id: 'design', title: 'design the thing'});
        expect(task.title).toBe('design the thing');
        expect(manager.getTask(id, 'design')).toBe(task);
        expect(manager.getProjectDetail(id).ongoingTasks).toEqual(['design']);
        expect(manager.getProjectDetail(id).tasks['build']!.blockedBy).toEqual(['design']);
    });

    /** What a task asks for turns out to be something else often enough to be worth rewriting. */
    test('rewrites the description of an ongoing task', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        expect(manager.updateTask(id, {id: 'design', description: 'sketch it first'}).task)
            .toMatchObject({description: 'sketch it first', status: 'ongoing'});
    });

    /** Who works on a task is the user's to change, up until somebody has taken it up. */
    test('hands a task still in todo to another agent', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        expect(manager.updateTask(id, {id: 'design', assignee: 'a2'}).task.assignee).toBe('a2');
    });

    test('refuses to hand an ongoing task to another agent', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        expect(() => manager.updateTask(id, {id: 'design', assignee: 'a2'}))
            .toThrow('Only a task still in todo can be handed to another agent.');
        expect(manager.getTask(id, 'design')!.assignee).toBe('a1');
    });

    test('refuses to hand a done task to another agent', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        manager.updateTask(id, {id: 'design', status: 'done'});
        expect(() => manager.updateTask(id, {id: 'design', assignee: 'a2'}))
            .toThrow('Only a task still in todo can be handed to another agent.');
    });

    /** Naming the agent already on it asks for nothing, and an update carrying it is no reassignment. */
    test('takes an update that repeats the assignee of an ongoing task', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        expect(manager.updateTask(id, {id: 'design', assignee: 'a1', title: 'design it'}).task)
            .toMatchObject({assignee: 'a1', title: 'design it'});
    });

    test('trims the words it is given', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        const {task} = manager.updateTask(
            id, {id: 'design', title: '  design the thing  ', description: '  sketch it  '}
        );
        expect(task).toMatchObject({title: 'design the thing', description: 'sketch it'});
    });

    test('refuses a title of nothing but spaces', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        expect(() => manager.updateTask(id, {id: 'design', title: '   '}))
            .toThrow('A task needs a title.');
    });

    test('refuses a description of nothing but spaces', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        expect(() => manager.updateTask(id, {id: 'design', description: '   '}))
            .toThrow('A task needs a description.');
    });

    test('throws when the task does not belong to the project', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        expect(() => manager.updateTask(id, {id: 'ghost', status: 'ongoing'})).toThrow('Task not found.');
    });

    test('throws for an unknown project id', () => {
        expect(() => manager.updateTask('ghost', {id: 'design', status: 'ongoing'})).toThrow('Task not found.');
    });

    test('refuses an output while the task is still todo', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        expect(() => manager.updateTask(id, {id: 'design', output: {type: 'text', content: 'result'}}))
            .toThrow('Cannot set output when task is in todo state.');
    });

    test('keeps the output of an ongoing task', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        const {task} = manager.updateTask(id, {id: 'design', output: {type: 'text', content: 'result'}});
        expect(task.output).toEqual({type: 'text', content: 'result'});
    });

    /** Filing it away again would write the placeholder of the report over the report itself. */
    test('files an output away when it arrives and never again', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        const content = 'x'.repeat(1501);
        manager.updateTask(id, {id: 'design', output: {type: 'text', content}});
        expect(mocks.writeFile).toHaveBeenCalledWith(`.projects/${id}/output/hash.txt`, content);
        mocks.writeFile.mockClear();
        const {task} = manager.updateTask(id, {id: 'design', status: 'done'});
        expect(mocks.writeFile).not.toHaveBeenCalledWith(
            expect.stringContaining('/output/'), expect.anything()
        );
        expect(task.output).toEqual({
            type: 'text',
            content: '<Content saved to file>',
            path: `/api/file/projects/${id}/output/hash.txt`,
        });
    });

    /** The file is named after the id, so a rename later cannot leave the report unreachable. */
    test('names the report file after the id rather than the title', () => {
        const {id} = newProject(manager, [newTask(manager, 'design', {id: 't1'})]);
        manager.updateTask(id, {id: 't1', status: 'ongoing'});
        manager.updateTask(id, {id: 't1', output: {type: 'text', content: 'x'.repeat(1501)}});
        expect(mocks.hashString).toHaveBeenCalledWith('t1');
    });

    test('holds a paused task back for verification instead of closing it', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', pause: true});
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        const {task, stop} = manager.updateTask(id, {id: 'design', status: 'done'});
        expect(stop).toBe(true);
        expect(task.status).toBe('ongoing');
        expect(task.verified).toBe(false);
    });

    test('only lets a paused task reach done when it was verified by an earlier update', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', pause: true});
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        manager.updateTask(id, {id: 'design', verified: true});
        const {task, stop} = manager.updateTask(id, {id: 'design', status: 'done'});
        expect(task.status).toBe('done');
        expect(stop).toBe(false);
    });

    test('expects the verification of a paused task in a call of its own', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', pause: true});
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        const {task, stop} = manager.updateTask(id, {id: 'design', status: 'done', verified: true});
        expect(task.status).toBe('ongoing');
        expect(stop).toBe(false);
    });

    test('closes the project once every task is done', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        manager.updateTask(id, {id: 'design', status: 'done'});
        const project = manager.getProjectDetail(id);
        expect(new Date(project.closedAt!).toISOString()).toBe(project.closedAt);
    });

    test('leaves the project open while a task is still pending', () => {
        const {id} = newProject(manager, [newTask(manager, 'design'), newTask(manager, 'build')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        manager.updateTask(id, {id: 'design', status: 'done'});
        expect(manager.getProjectDetail(id).closedAt).toBeUndefined();
    });

    test('unblocks the dependent task once its blocker is done', () => {
        const {id} = newProject(manager, [
            newTask(manager, 'design'), newTask(manager, 'build', {blockedBy: ['design']}),
        ]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        manager.updateTask(id, {id: 'design', status: 'done'});
        expect(manager.getProjectDetail(id).canStartTasks).toEqual(['build']);
    });
});

describe('updateTask steps', () => {

    let manager: ProjectManagerType;

    beforeEach(async () => {
        manager = await loadManager();
    });

    test('adds steps to a todo task', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        const {task} = manager.updateTask(id, {id: 'design'}, ['one', 'two']);
        expect(task.stepsStatus).toEqual({steps: ['one', 'two'], currentStepIndex: -1});
    });

    test('rejects more steps than the limit allows', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        const steps = newSteps(PROJECT_CONFIG.maxTaskStepsCount + 1);
        expect(() => manager.updateTask(id, {id: 'design'}, steps))
            .toThrow('Too much steps for a task. Max is 8.');
    });

    test('refuses to replace the steps of an ongoing task that already has some', () => {
        const {id} = newProject(manager, [newTask(manager, 'design', {steps: ['one']})]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        expect(() => manager.updateTask(id, {id: 'design'}, ['two'])).toThrow('Cannot update steps.');
    });

    test('allows adding steps to an ongoing task that has none', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        const {task} = manager.updateTask(id, {id: 'design'}, ['one']);
        expect(task.stepsStatus).toEqual({steps: ['one'], currentStepIndex: -1});
    });

    test('refuses to add steps and mark the task done at once', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        expect(() => manager.updateTask(id, {id: 'design', status: 'done'}, ['one']))
            .toThrow('Cannot add steps and mark task done at the same time.');
    });

    test('refuses to finish a task whose steps are not all done', () => {
        const {id} = newProject(manager, [newTask(manager, 'design', {steps: ['one', 'two']})]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        manager.updateCurrentStep(id, 'design', 1);
        expect(() => manager.updateTask(id, {id: 'design', status: 'done'}))
            .toThrow('All steps should be completed before marking the task as done.');
    });

    test('finishes a task once the current step passed the last one', () => {
        const {id} = newProject(manager, [newTask(manager, 'design', {steps: ['one', 'two']})]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        manager.updateCurrentStep(id, 'design', 2);
        expect(manager.updateTask(id, {id: 'design', status: 'done'}).task.status).toBe('done');
    });
});

describe('updateCurrentStep', () => {

    let manager: ProjectManagerType;

    beforeEach(async () => {
        manager = await loadManager();
    });

    function newOngoingProject(steps: string[]): string {
        const {id} = newProject(manager, [newTask(manager, 'design', {steps})]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        return id;
    }

    test('moves the current step forward and persists it', () => {
        const id = newOngoingProject(['one', 'two']);
        mocks.writeFile.mockClear();
        expect(manager.updateCurrentStep(id, 'design', 1)).toEqual({steps: ['one', 'two'], currentStepIndex: 1});
        expect(mocks.writeFile).toHaveBeenCalledOnce();
    });

    test('accepts the index right after the last step', () => {
        const id = newOngoingProject(['one', 'two']);
        expect(manager.updateCurrentStep(id, 'design', 2).currentStepIndex).toBe(2);
    });

    test('rejects an index past the step list', () => {
        const id = newOngoingProject(['one', 'two']);
        expect(() => manager.updateCurrentStep(id, 'design', 3)).toThrow('Invalid step index.');
    });

    test('rejects a negative index', () => {
        const id = newOngoingProject(['one', 'two']);
        expect(() => manager.updateCurrentStep(id, 'design', -1)).toThrow('Invalid step index.');
    });

    test('throws when the task has no steps', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        expect(() => manager.updateCurrentStep(id, 'design', 0))
            .toThrow('No steps found for the specified task.');
    });

    test('throws when the task is unknown', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        expect(() => manager.updateCurrentStep(id, 'ghost', 0))
            .toThrow('No steps found for the specified task.');
    });

    test('refuses to move the step of a task that is not ongoing', () => {
        const {id} = newProject(manager, [newTask(manager, 'design', {steps: ['one']})]);
        expect(() => manager.updateCurrentStep(id, 'design', 0))
            .toThrow('Can only update current step for ongoing tasks.');
    });
});

describe('getProjectList', () => {

    let manager: ProjectManagerType;

    beforeEach(async () => {
        manager = await loadManager();
    });

    function closeProject(): string {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        manager.updateTask(id, {id: 'design', status: 'done'});
        return id;
    }

    test('reports an open project with its id, title and description only', () => {
        const project = newProject(manager, [newTask(manager, 'design')]);
        expect(manager.getProjectList(false)).toEqual({projects: {
            open: [{id: project.id, title: 'Ship it', description: 'ship the thing'}],
            closed: [],
        }});
    });

    test('hides closed projects unless they are asked for', () => {
        closeProject();
        expect(manager.getProjectList(false).projects.closed).toEqual([]);
    });

    test('lists closed projects when asked for', () => {
        const id = closeProject();
        const list = manager.getProjectList(true);
        expect(list.projects.closed.map(project => project.id)).toEqual([id]);
        expect(list.projects.open).toEqual([]);
    });

    test('keeps open and closed projects apart', () => {
        const closed = closeProject();
        const open = newProject(manager, [newTask(manager, 'build')]).id;
        const list = manager.getProjectList(true);
        expect(list.projects.open.map(project => project.id)).toEqual([open]);
        expect(list.projects.closed.map(project => project.id)).toEqual([closed]);
    });
});

describe('archiveProject', () => {

    let manager: ProjectManagerType;

    beforeEach(async () => {
        manager = await loadManager();
    });

    test('writes the date it was put away into the project on disk', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        const archived = manager.archiveProject(id);
        expect(archived.archivedAt).toEqual(expect.any(String));
        const written = mocks.writeFile.mock.calls[mocks.writeFile.mock.calls.length - 1]!;
        expect(written[0]).toBe(`.projects/${id}/project.json`);
        expect(JSON.parse(written[1]).archivedAt).toBe(archived.archivedAt);
    });

    /** Written where the project lies and moved after, so the copy that lands carries the date. */
    test('moves the whole folder to the archive under the id it had', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.archiveProject(id);
        expect(mocks.movePath).toHaveBeenCalledWith(`.projects/${id}`, `.archivedProjects/${id}`);
        expect(mocks.writeFile.mock.calls.at(-1)![0]).toBe(`.projects/${id}/project.json`);
        expect(mocks.movePath.mock.invocationCallOrder[0])
            .toBeGreaterThan(mocks.writeFile.mock.invocationCallOrder.at(-1)!);
    });

    /** A folder that is not there is not a project that was archived, whatever the write said. */
    test('keeps the project when its folder is nowhere to be moved', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        mocks.movePath.mockReturnValue(false);
        expect(() => manager.archiveProject(id))
            .toThrow(`The folder of project ${id} went missing before it was archived.`);
        expect(manager.getProjectDetail(id).archivedAt).toBeUndefined();
    });

    test('keeps the project when the move throws', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        mocks.movePath.mockImplementation(() => {
            throw new Error('the archive folder is read only');
        });
        expect(() => manager.archiveProject(id)).toThrow('the archive folder is read only');
        expect(manager.getProjectDetail(id).title).toBe('Ship it');
        expect(manager.getProjectDetail(id).archivedAt).toBeUndefined();
    });

    /** Everything reading the map is done with it at once, rather than each having to ask. */
    test('leaves the project nowhere to be found here', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        manager.archiveProject(id);
        expect(manager.getProjectList(true)).toEqual({projects: {open: [], closed: []}});
        expect(() => manager.getProjectDetail(id)).toThrow('Project not found.');
        expect(manager.getTask(id, 'design')).toBeUndefined();
    });

    /**
     * Written before it is forgotten, so a disk that will not take it changes nothing at all -- the
     * date included. A date left on the project would reach disk under the next edit of any task in
     * it, every write being a write of the whole project, and the restart after that would pass over
     * a project the user was told had stayed.
     */
    test('keeps the project as it was when the write fails', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        mocks.writeFile.mockImplementation(() => {
            throw new Error('disk full');
        });
        expect(() => manager.archiveProject(id)).toThrow('disk full');
        expect(manager.getProjectDetail(id).title).toBe('Ship it');
        expect(manager.getProjectDetail(id).archivedAt).toBeUndefined();
    });

    /** The date only ever reaches disk as part of archiving, so an edit after a failed one is clean. */
    test('writes no archive date under a later task edit when the write failed', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        mocks.writeFile.mockImplementationOnce(() => {
            throw new Error('disk full');
        });
        expect(() => manager.archiveProject(id)).toThrow('disk full');
        manager.updateTask(id, {id: 'design', status: 'ongoing'});
        const written = mocks.writeFile.mock.calls[mocks.writeFile.mock.calls.length - 1]!;
        expect(JSON.parse(written[1]).archivedAt).toBeUndefined();
    });

    test('throws for an unknown id', () => {
        expect(() => manager.archiveProject('ghost')).toThrow('Project not found.');
    });
});

describe('startProject', () => {

    let manager: ProjectManagerType;

    beforeEach(async () => {
        manager = await loadManager();
    });

    test('writes the date the user set the work going', () => {
        const {id} = newPlannedProject(manager, [newTask(manager, 'design')]);
        expect(manager.getProjectDetail(id).startedAt).toBeUndefined();
        const started = manager.startProject(id);
        expect(started.startedAt).toBeTruthy();
        expect(manager.getProjectDetail(id).startedAt).toBe(started.startedAt);
    });

    test('keeps the project on disk with the date on it', () => {
        const {id} = newPlannedProject(manager, [newTask(manager, 'design')]);
        manager.startProject(id);
        const written = mocks.writeFile.mock.calls[mocks.writeFile.mock.calls.length - 1]!;
        expect(JSON.parse(written[1]).startedAt).toBe(manager.getProjectDetail(id).startedAt);
    });

    /** Two tabs showing the button both press it, and the moment work began is not a thing to move. */
    test('stands by the first date when it is started again', () => {
        const {id} = newPlannedProject(manager, [newTask(manager, 'design')]);
        const first = manager.startProject(id).startedAt;
        expect(manager.startProject(id).startedAt).toBe(first);
    });

    test('throws for an unknown id', () => {
        expect(() => manager.startProject('ghost')).toThrow('Project not found.');
    });
});

describe('getProjectDetail', () => {

    let manager: ProjectManagerType;

    beforeEach(async () => {
        manager = await loadManager();
    });

    test('returns the stored project including its tasks', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        expect(Object.keys(manager.getProjectDetail(id).tasks)).toEqual(['design']);
    });

    test('throws for an unknown id', () => {
        expect(() => manager.getProjectDetail('ghost')).toThrow('Project not found.');
    });
});

describe('prompts', () => {

    let manager: ProjectManagerType;

    beforeEach(async () => {
        manager = await loadManager();
    });

    test('describes the project tools', () => {
        expect(manager.promptManagementTools()).toContain('## Project Management tools');
    });

    /**
     * The section reaches the runs holding these tools now, so it has nobody left to excuse itself
     * to. What a subagent may do to a task is told to the subagent, in its identity and in the task
     * it was handed, and to the loop handing it over in the delegation section.
     */
    test('names no run that would be reading it without the tools', () => {
        const prompt = manager.promptManagementTools();
        expect(prompt).not.toContain('subloop');
        expect(prompt).not.toContain('A subagent cannot');
    });

    test('describes the current project with its tasks and buckets', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        const prompt = manager.promptCurrentProject(id);
        expect(prompt).toContain('## You are currently working on the project below:');
        expect(prompt).toContain('"canStartTasks":["design"]');
    });

    test('says nothing about an unknown project', () => {
        expect(manager.promptCurrentProject('ghost')).toBe('');
    });

    /**
     * Said with the project rather than in the delegation section, which is the same words for
     * every project run: this is what changes under a run, the user pressing start in the middle
     * of the conversation being the ordinary way it happens.
     */
    test('says a project nobody started is still waiting on the user', () => {
        const {id} = newPlannedProject(manager, [newTask(manager, 'design')]);
        expect(manager.promptCurrentProject(id)).toContain('has not started this project yet');
    });

    test('says nothing of starting once the work is on', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        expect(manager.promptCurrentProject(id)).not.toContain('has not started this project yet');
    });

    /** A project carrying work of its own is one that was started, whatever wrote the date. */
    test('says nothing of starting to a project already at work without a date', async () => {
        const started = await loadManager({p1: {dir: '.projects/p1', content: storedProject({
            tasks: {
                design: {title: 'design', description: 'd', status: 'ongoing', priority: 'low', blockedBy: [], blocks: []},
            },
        })}});
        expect(started.promptCurrentProject('p-stored')).not.toContain('has not started this project yet');
    });

    test('tells the project owner to hand its tasks to subagents', () => {
        const prompt = manager.promptTaskDelegation();
        expect(prompt).toContain('## Run the tasks through subagents');
        expect(prompt).toContain('Nothing of a project goes out before the user starts it');
        expect(prompt).toContain('call the task_loop tool with the id of the task');
        expect(prompt).toContain('Use sub_loop instead where there is nothing on the board');
        expect(prompt).toContain('Handing a task over marks it ongoing');
        expect(prompt).toContain('subagent itself only moves the step index');
        expect(prompt).toContain('A subagent can put a question to the user');
    });

    test('describes the task a sub loop was assigned to', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        const prompt = manager.promptAssignedTask(id, 'design');
        expect(prompt).toContain('## You were assigned this single task');
        // Without the id in front of it the subagent has nothing to move its step index by.
        expect(prompt).toContain('"id":"design"');
        expect(prompt).toContain('"title":"design"');
        expect(prompt).toContain('"description":"design description"');
        expect(prompt).toContain('do not pick up other tasks of the project');
    });

    test('asks for the step index to be kept up to date when the task has steps', () => {
        const {id} = newProject(manager, [newTask(manager, 'design', {steps: newSteps(2)})]);
        const prompt = manager.promptAssignedTask(id, 'design');
        expect(prompt).toContain('"steps":["step 0","step 1"]');
        expect(prompt).toContain('update_task_current_step');
    });

    test('leaves out the step instruction for a task without steps', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        expect(manager.promptAssignedTask(id, 'design')).not.toContain('update_task_current_step');
    });

    test('says nothing about a task the project does not have', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        expect(manager.promptAssignedTask(id, 'ghost')).toBe('');
        expect(manager.promptAssignedTask('ghost', 'design')).toBe('');
    });
});
