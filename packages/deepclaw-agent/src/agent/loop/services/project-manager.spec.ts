import {beforeEach, describe, expect, test, vi} from 'vitest';
import {PROJECT_CONFIG, type Project, type Task} from '@deepclaw/core';

const mocks = vi.hoisted(() => ({
    readDir: vi.fn<(dir: string) => Record<string, {dir: string; content: string}>>(() => ({})),
    writeFile: vi.fn<(path: string, content: string) => string>((path: string) => path),
    exists: vi.fn<(path: string) => boolean>(() => false),
    hashString: vi.fn<(text: string) => string>(() => 'hash'),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {
        readDir: mocks.readDir,
        writeFile: mocks.writeFile,
        exists: mocks.exists,
        hashString: mocks.hashString,
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

function newProject(manager: ProjectManagerType, tasks: Task[]): Project {
    return manager.createProject(
        {agentId: 'a1', title: 'Ship it', description: 'ship the thing', priority: 'high'}, tasks
    );
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
        const project = newProject(manager, [newTask(manager, 'design')]);
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

    test('replaces the tasks while the project is still todo', () => {
        const {id} = newProject(manager, [newTask(manager, 'design')]);
        const updated = manager.updateProject({id}, [newTask(manager, 'build')]);
        expect(Object.keys(updated.tasks)).toEqual(['build']);
        expect(updated.canStartTasks).toEqual(['build']);
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

    test('keeps the status of a task away from a subagent', () => {
        expect(manager.promptManagementTools())
            .toContain('A subagent cannot update a task, it only moves the step index');
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

    test('tells the project owner to hand its tasks to subagents', () => {
        const prompt = manager.promptTaskDelegation();
        expect(prompt).toContain('## Run the tasks through subagents');
        expect(prompt).toContain('call the task_loop tool with the id of the task');
        expect(prompt).toContain('Use sub_loop instead where there is nothing on the board');
        expect(prompt).toContain('Handing a task over marks it ongoing');
        expect(prompt).toContain('A subagent reaches no user');
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
