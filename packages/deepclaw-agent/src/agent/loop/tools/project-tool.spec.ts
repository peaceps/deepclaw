import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentIdentity, type Project, type Task, type TaskStepsContext} from '@deepclaw/core';
import {newTestContext as newLoopContext} from '../../../test-support/one-loop-context';
import {type OneLoopContext} from '../../definitions/definitions';
import {projectFilesDir} from '../../paths';
import {AgentIdentityManager} from '../services/agent-identity-manager';
import {ProjectManager} from '../services/project-manager';
import {RunningTaskService} from '../services/running-task-service';
import {
    addTaskTool,
    createProjectTool,
    getProjectDetailTool,
    getProjectListTool,
    updateProjectTool,
    updateTaskTool,
    updateTaskCurrentStepTool,
    workOnTaskTool,
} from './project-tool';

const mocks = vi.hoisted(() => ({
    publishGeneratedFiles: vi.fn<
        (output: {content: string}, files: string[], folder: string)
            => {published: string[], skipped: string[]}
    >(() => ({published: [], skipped: []})),
}));

vi.mock('@deepclaw/i18n', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/i18n')>()),
    i18nInstance: {t: (key: string) => key},
}));
vi.mock('../../loop-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../loop-utils')>()),
    publishGeneratedFiles: mocks.publishGeneratedFiles,
}));
vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {readDir: vi.fn(() => ({})), writeFile: vi.fn(), exists: vi.fn(() => false)},
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

const createTask = vi.spyOn(ProjectManager, 'createTask');
const createProject = vi.spyOn(ProjectManager, 'createProject');
const updateProject = vi.spyOn(ProjectManager, 'updateProject');
const addTask = vi.spyOn(ProjectManager, 'addTask');
const updateTask = vi.spyOn(ProjectManager, 'updateTask');
const getTask = vi.spyOn(ProjectManager, 'getTask');
const updateCurrentStep = vi.spyOn(ProjectManager, 'updateCurrentStep');
const getProjectList = vi.spyOn(ProjectManager, 'getProjectList');
const getProjectDetail = vi.spyOn(ProjectManager, 'getProjectDetail');
const getAgent = vi.spyOn(AgentIdentityManager, 'getAgent');
const getAgents = vi.spyOn(AgentIdentityManager, 'getAgents');

function newTask(id: string, title = id): Task {
    return {id, title, description: `${title} desc`, priority: 'medium', status: 'todo'} as Task;
}

function newIdentity(id: string, fired = false): AgentIdentity {
    return {id, fired, name: id, role: 'engineer'} as AgentIdentity;
}

function newProject(overrides: Partial<Project> = {}): Project {
    return {
        id: 'pr1', title: 'ship it', description: 'ship the thing', tasks: {}, ...overrides,
    } as Project;
}

/**
 * The run of pr1, which is what every project in this file is. The board of a project is written
 * by the conversation of that project and by no other, so a context that runs no project is not
 * the caller any of this has: it would be turned away before the thing under test happened.
 */
function newTestContext(overrides: Partial<OneLoopContext> = {}): OneLoopContext {
    return newLoopContext({
        role: 'project', projectId: 'pr1', loopId: 'project.a1.pr1', ...overrides,
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.publishGeneratedFiles.mockReturnValue({published: [], skipped: []});
    createTask.mockImplementation(info => newTask(info.id, info.title));
    createProject.mockReturnValue(newProject());
    updateProject.mockReturnValue(newProject());
    addTask.mockReturnValue(newTask('build'));
    // Work under way is where a task spends every write but the one that started it.
    getTask.mockReturnValue({...newTask('design'), status: 'ongoing'});
    getProjectDetail.mockReturnValue(newProject());
    getAgent.mockImplementation(id => newIdentity(id));
    getAgents.mockReturnValue([newIdentity('a1'), newIdentity('a2'), newIdentity('a3', true)]);
});

/** A turn is what ends the work a run took on, and the service holding it is one per process. */
afterEach(() => {
    ['agent.a1', 'project.a1.pr1'].forEach(loopId => RunningTaskService.endMainLoopRun(loopId));
});

describe('createProjectTool invoke', () => {

    test('creates every task for the current agent before creating the project', async () => {
        await createProjectTool.invoke({
            title: 'ship it',
            description: 'ship the thing',
            priority: 'high',
            tasks: [
                {id: 'design', title: 'design', description: 'design it', priority: 'medium'},
                {id: 'build', title: 'build', description: 'build it', priority: 'high', blockedBy: ['design']},
            ],
        }, newTestContext());
        expect(createTask).toHaveBeenCalledTimes(2);
        expect(createTask).toHaveBeenNthCalledWith(2, {
            id: 'build', title: 'build', description: 'build it', priority: 'high',
            blockedBy: ['design'], agentId: 'a1',
        });
        expect(createProject).toHaveBeenCalledExactlyOnceWith(
            {agentId: 'a1', title: 'ship it', description: 'ship the thing', priority: 'high'},
            [newTask('design'), newTask('build')]
        );
    });

    test('files a task under the agent it was handed to', async () => {
        await createProjectTool.invoke({
            title: 'ship it',
            description: 'ship the thing',
            priority: 'high',
            tasks: [{id: 'design', title: 'design', description: 'design it', priority: 'medium', assignee: 'a2'}],
        }, newTestContext());
        expect(createTask).toHaveBeenCalledExactlyOnceWith({
            id: 'design', title: 'design', description: 'design it', priority: 'medium',
            assignee: 'a2', agentId: 'a1',
        });
    });

    /** An id nobody has would send the subagent of the task out as a stranger. */
    test('refuses a task handed to somebody who does not work here', async () => {
        getAgent.mockReturnValue(undefined);
        await expect(createProjectTool.invoke({
            title: 'ship it',
            description: 'ship the thing',
            priority: 'high',
            tasks: [{id: 'design', title: 'design', description: 'design it', priority: 'medium', assignee: 'ghost'}],
        }, newTestContext())).rejects.toThrow('No agent "ghost" works here, assign the task to one of: a1, a2.');
        expect(createProject).not.toHaveBeenCalled();
    });

    test('refuses a task handed to an agent that was fired', async () => {
        getAgent.mockImplementation(id => newIdentity(id, true));
        await expect(createProjectTool.invoke({
            title: 'ship it',
            description: 'ship the thing',
            priority: 'high',
            tasks: [{id: 'design', title: 'design', description: 'design it', priority: 'medium', assignee: 'a3'}],
        }, newTestContext())).rejects.toThrow('No agent "a3" works here');
    });

    test('keeps the agent a task of the plan is read over by', async () => {
        await createProjectTool.invoke({
            title: 'ship it',
            description: 'ship the thing',
            priority: 'high',
            tasks: [{
                id: 'design', title: 'design', description: 'design it',
                priority: 'medium', reviewer: 'a2',
            }],
        }, newTestContext());
        expect(createTask).toHaveBeenCalledExactlyOnceWith({
            id: 'design', title: 'design', description: 'design it', priority: 'medium',
            reviewer: 'a2', agentId: 'a1',
        });
    });

    test('refuses a task left to be read over by somebody who does not work here', async () => {
        getAgent.mockReturnValue(undefined);
        await expect(createProjectTool.invoke({
            title: 'ship it',
            description: 'ship the thing',
            priority: 'high',
            tasks: [{
                id: 'design', title: 'design', description: 'design it',
                priority: 'medium', reviewer: 'ghost',
            }],
        }, newTestContext())).rejects.toThrow('No agent "ghost" works here, pick a reviewer from: a1, a2.');
        expect(createProject).not.toHaveBeenCalled();
    });

    /**
     * The run is left going. There is nothing it could do to the project from here -- the board
     * tools belong to the run of the project and no task moves before the user starts it -- so what
     * this has to get right is that the answer says where the project went.
     */
    test('announces the new project and leaves the run going', async () => {
        const context = newTestContext();
        const result = await createProjectTool.invoke({
            title: 'ship it', description: 'ship the thing', priority: 'high', tasks: [],
        }, context);
        // A project reaches a browser with the count of its tasks, which a row that never opened
        // holds in place of them.
        expect(context.actions.agentHandler.onInfoEvent).toHaveBeenCalledExactlyOnceWith({
            eventType: 'updateProject', content: {...newProject(), taskCount: 0},
        });
        expect(context.runtime.agentBreakReason).toBeUndefined();
        expect(result).toContain('Project created successfully.');
        expect(result).toContain(JSON.stringify(newProject()));
        expect(result).toContain('worked in a conversation of its own, on its row of the board');
        expect(result).toContain('until\nthey start it on that row');
    });
});

describe('updateProjectTool invoke', () => {

    test('patches the project without rebuilding its tasks', async () => {
        await updateProjectTool.invoke({projectId: 'pr1', title: 'ship it faster'}, newTestContext());
        expect(createTask).not.toHaveBeenCalled();
        expect(updateProject).toHaveBeenCalledExactlyOnceWith({id: 'pr1', title: 'ship it faster'}, undefined);
    });

    /**
     * Nothing holds a call to the schema by the time it lands here, additionalProperties being a
     * word only some providers keep. The date the user set the work going is the one field of a
     * project no run may write, and a field this tool never named reaches no further than this.
     */
    test('leaves a field the model made up out of the patch', async () => {
        await updateProjectTool.invoke({
            projectId: 'pr1', title: 'ship it faster',
            startedAt: '2026-01-01T00:00:00.000Z',
            closedAt: '2026-01-01T00:00:00.000Z',
        } as Parameters<typeof updateProjectTool.invoke>[0], newTestContext());
        expect(updateProject)
            .toHaveBeenCalledExactlyOnceWith({id: 'pr1', title: 'ship it faster'}, undefined);
    });

    test('rebuilds the task list when new tasks are given', async () => {
        await updateProjectTool.invoke({
            projectId: 'pr1',
            tasks: [{id: 'design', title: 'design', description: 'design it', priority: 'low'}],
        }, newTestContext());
        expect(updateProject).toHaveBeenCalledExactlyOnceWith({id: 'pr1'}, [newTask('design')]);
    });

    test('keeps the assignee of every rebuilt task', async () => {
        await updateProjectTool.invoke({
            projectId: 'pr1',
            tasks: [{id: 'design', title: 'design', description: 'design it', priority: 'low', assignee: 'a2'}],
        }, newTestContext());
        expect(createTask).toHaveBeenCalledExactlyOnceWith({
            id: 'design', title: 'design', description: 'design it', priority: 'low',
            assignee: 'a2', agentId: 'a1',
        });
    });

    test('refuses a rebuilt task handed to somebody who does not work here', async () => {
        getAgent.mockReturnValue(undefined);
        await expect(updateProjectTool.invoke({
            projectId: 'pr1',
            tasks: [{id: 'design', title: 'design', description: 'design it', priority: 'low', assignee: 'ghost'}],
        }, newTestContext())).rejects.toThrow('No agent "ghost" works here');
        expect(updateProject).not.toHaveBeenCalled();
    });

    test('reports the project back and notifies the ui', async () => {
        const context = newTestContext();
        const result = await updateProjectTool.invoke({projectId: 'pr1'}, context);
        expect(context.actions.agentHandler.onInfoEvent).toHaveBeenCalledExactlyOnceWith({
            eventType: 'updateProject', content: {...newProject(), taskCount: 0},
        });
        expect(result).toContain('Project updated successfully.');
        expect(context.runtime.agentBreakReason).toBeUndefined();
    });

    /** A rename of the project is no reason to read every report of it back. */
    test('leaves what the tasks produced out of the answer', async () => {
        updateProject.mockReturnValue(newProject({tasks: {
            design: {...newTask('design'), output: {type: 'markdown', content: '# the whole report'}},
        }}));
        const result = await updateProjectTool.invoke(
            {projectId: 'pr1', title: 'ship it faster'}, newTestContext()
        );
        expect(result).not.toContain('the whole report');
        expect(result).toContain('<Output kept, read it with get_project_detail>');
    });

    test('passes the report of the project through to the manager', async () => {
        const output = {type: 'markdown' as const, content: '# how it went'};
        await updateProjectTool.invoke({projectId: 'pr1', output}, newTestContext());
        expect(updateProject).toHaveBeenCalledExactlyOnceWith({id: 'pr1', output}, undefined);
    });

    test('refuses a report that is the bytes of a file', async () => {
        await expect(updateProjectTool.invoke({
            projectId: 'pr1', output: {type: 'binary', content: 'MjAyNQ=='},
        }, newTestContext())).rejects.toThrow('An output carries what the user reads');
        expect(updateProject).not.toHaveBeenCalled();
    });

    /** The run that just wrote the report would otherwise read its own words straight back. */
    test('leaves the report of the project out of the answer', async () => {
        updateProject.mockReturnValue(
            newProject({output: {type: 'markdown', content: '# the whole report'}})
        );
        const result = await updateProjectTool.invoke(
            {projectId: 'pr1', output: {type: 'markdown', content: '# the whole report'}},
            newTestContext()
        );
        expect(result).not.toContain('the whole report');
        expect(result).toContain('<Output kept, read it with get_project_detail>');
    });
});

describe('addTaskTool invoke', () => {

    test('passes the task through to the manager under the agent adding it', async () => {
        await addTaskTool.invoke({
            projectId: 'pr1', id: 'build', title: 'build it',
            description: 'build the thing', priority: 'high',
        }, newTestContext());
        expect(addTask).toHaveBeenCalledExactlyOnceWith('pr1', {
            id: 'build', title: 'build it', description: 'build the thing',
            priority: 'high', agentId: 'a1',
        });
    });

    test('keeps an assignee that was named', async () => {
        await addTaskTool.invoke({
            projectId: 'pr1', id: 'build', title: 'build it',
            description: 'build the thing', priority: 'high', assignee: 'a2',
        }, newTestContext());
        expect(addTask).toHaveBeenCalledExactlyOnceWith('pr1', {
            id: 'build', title: 'build it', description: 'build the thing',
            priority: 'high', assignee: 'a2', agentId: 'a1',
        });
    });

    test('refuses a task handed to somebody who does not work here', async () => {
        getAgent.mockReturnValue(undefined);
        await expect(addTaskTool.invoke({
            projectId: 'pr1', id: 'build', title: 'build it',
            description: 'build the thing', priority: 'high', assignee: 'ghost',
        }, newTestContext())).rejects.toThrow('No agent "ghost" works here');
        expect(addTask).not.toHaveBeenCalled();
    });

    test('keeps a reviewer that was named', async () => {
        await addTaskTool.invoke({
            projectId: 'pr1', id: 'build', title: 'build it',
            description: 'build the thing', priority: 'high', reviewer: 'a3',
        }, newTestContext());
        expect(addTask).toHaveBeenCalledExactlyOnceWith('pr1', {
            id: 'build', title: 'build it', description: 'build the thing',
            priority: 'high', reviewer: 'a3', agentId: 'a1',
        });
    });

    /**
     * The way in that a task most often arrives by, and the one where a reviewer nobody can be
     * built for is worst: a task added to a project under way is ongoing soon after, and from
     * there the name cannot be changed. Every close would be turned away by a review no run can
     * do, and the user's own hand would be the only way the task ever finished.
     */
    test('refuses a task read over by somebody who does not work here', async () => {
        getAgent.mockReturnValue(undefined);
        await expect(addTaskTool.invoke({
            projectId: 'pr1', id: 'build', title: 'build it',
            description: 'build the thing', priority: 'high', reviewer: 'ghost',
        }, newTestContext())).rejects.toThrow('No agent "ghost" works here, pick a reviewer from');
        expect(addTask).not.toHaveBeenCalled();
    });

    test('announces the board and reports the project back', async () => {
        const context = newTestContext();
        const result = await addTaskTool.invoke({
            projectId: 'pr1', id: 'build', title: 'build it',
            description: 'build the thing', priority: 'high',
        }, context);
        expect(context.actions.agentHandler.onInfoEvent).toHaveBeenCalledExactlyOnceWith({
            eventType: 'updateProject', content: {...newProject(), taskCount: 0},
        });
        expect(result).toContain('Task added successfully.');
        expect(result).toContain(JSON.stringify(newProject()));
    });

    /**
     * The answer of a write is the copy of the board that lands closest to the next decision, so it
     * is the one place the old name would have done the most: a list called "tasks that can start",
     * arriving on the heels of a task just written.
     */
    test('reports the tasks nothing blocks under the name the prompt uses', async () => {
        getProjectDetail.mockReturnValue(newProject({canStartTasks: ['build']}));
        const result = await addTaskTool.invoke({
            projectId: 'pr1', id: 'build', title: 'build it',
            description: 'build the thing', priority: 'high',
        }, newTestContext());
        expect(result).toContain('"notBlockedTasks":["build"]');
        expect(result).not.toContain('canStartTasks');
    });

    /** The plan was already agreed on, so the run goes on: only a project of its own stops for one. */
    test('leaves the loop running', async () => {
        const context = newTestContext();
        await addTaskTool.invoke({
            projectId: 'pr1', id: 'build', title: 'build it',
            description: 'build the thing', priority: 'high',
        }, context);
        expect(context.runtime.agentBreakReason).toBeUndefined();
    });
});

describe('the report a closed project is asked for', () => {

    /** Two tasks, both done: a project that closed and has nothing said about the whole of it. */
    function closedProject(overrides: Partial<Project> = {}): Project {
        return newProject({
            closedAt: '2024-01-02T00:00:00.000Z',
            tasks: {design: newTask('design'), build: newTask('build')},
            ...overrides,
        });
    }

    const ASKED = 'write it now with update_project';

    beforeEach(() => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
    });

    test('is asked for once the last task closed the project', async () => {
        getProjectDetail.mockReturnValue(closedProject());
        const result = await updateTaskTool.invoke(
            {projectId: 'pr1', taskId: 'design', status: 'done'}, newTestContext()
        );
        expect(result).toContain(ASKED);
    });

    test('is not asked for again once it was written', async () => {
        getProjectDetail.mockReturnValue(
            closedProject({output: {type: 'markdown', content: '# how it went'}})
        );
        const result = await updateTaskTool.invoke(
            {projectId: 'pr1', taskId: 'design', status: 'done'}, newTestContext()
        );
        expect(result).not.toContain(ASKED);
    });

    test('is not asked for while a task of the project is still open', async () => {
        getProjectDetail.mockReturnValue(closedProject({closedAt: undefined}));
        const result = await updateTaskTool.invoke(
            {projectId: 'pr1', taskId: 'design', status: 'done'}, newTestContext()
        );
        expect(result).not.toContain(ASKED);
    });

    /** A project of one task, whose one task report already says the whole of it. */
    test('is not asked for from a project of a single task', async () => {
        getProjectDetail.mockReturnValue(closedProject({tasks: {design: newTask('design')}}));
        const result = await updateTaskTool.invoke(
            {projectId: 'pr1', taskId: 'design', status: 'done'}, newTestContext()
        );
        expect(result).not.toContain(ASKED);
    });

    /** Every write of a closed project is another moment to ask, not only a write of a task. */
    test('is asked for again where the project was written to for something else', async () => {
        updateProject.mockReturnValue(closedProject());
        const result = await updateProjectTool.invoke(
            {projectId: 'pr1', title: 'ship it faster'}, newTestContext()
        );
        expect(result).toContain(ASKED);
    });

    test('is not asked for in the answer to writing it', async () => {
        const output = {type: 'markdown' as const, content: '# how it went'};
        updateProject.mockReturnValue(closedProject({output}));
        const result = await updateProjectTool.invoke({projectId: 'pr1', output}, newTestContext());
        expect(result).not.toContain(ASKED);
    });
});

describe('updateTaskTool invoke', () => {

    test('only forwards the optional fields that were provided', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        await updateTaskTool.invoke({projectId: 'pr1', taskId: 'design', status: 'ongoing'}, newTestContext());
        expect(updateTask).toHaveBeenCalledExactlyOnceWith(
            'pr1', {id: 'design', status: 'ongoing'}, undefined
        );
    });

    test('passes output and steps through to the manager', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        const output = {type: 'markdown' as const, content: '# done'};
        await updateTaskTool.invoke({
            projectId: 'pr1', taskId: 'design', output, steps: ['one', 'two'],
        }, newTestContext());
        expect(updateTask).toHaveBeenCalledExactlyOnceWith(
            'pr1', {id: 'design', output}, ['one', 'two']
        );
    });

    /** The board is the one place a task is handed on from, and the agent works it from here. */
    test('hands a task to another agent', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        await updateTaskTool.invoke({
            projectId: 'pr1', taskId: 'design', assignee: 'a2',
        }, newTestContext());
        expect(updateTask).toHaveBeenCalledExactlyOnceWith(
            'pr1', {id: 'design', assignee: 'a2'}, undefined
        );
    });

    test('refuses to hand a task to somebody who does not work here', async () => {
        getAgent.mockReturnValue(undefined);
        await expect(updateTaskTool.invoke({
            projectId: 'pr1', taskId: 'design', assignee: 'ghost',
        }, newTestContext())).rejects.toThrow('No agent "ghost" works here');
        expect(updateTask).not.toHaveBeenCalled();
    });

    test('refuses to hand a task to an agent that was let go', async () => {
        getAgent.mockImplementation(id => newIdentity(id, true));
        await expect(updateTaskTool.invoke({
            projectId: 'pr1', taskId: 'design', assignee: 'a3',
        }, newTestContext())).rejects.toThrow('No agent "a3" works here');
        expect(updateTask).not.toHaveBeenCalled();
    });

    /**
     * Dropped here, a call that named nobody would report success and change nothing, and the model
     * would read that as a task it had handed on. The service is where a blank name is turned away,
     * so it has to reach the service.
     */
    test('hands a blank assignee on to the service rather than dropping it', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        await updateTaskTool.invoke({
            projectId: 'pr1', taskId: 'design', assignee: '',
        }, newTestContext());
        expect(updateTask).toHaveBeenCalledExactlyOnceWith(
            'pr1', {id: 'design', assignee: ''}, undefined
        );
    });

    test('names an agent to read the task over', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        await updateTaskTool.invoke({
            projectId: 'pr1', taskId: 'design', reviewer: 'a2',
        }, newTestContext());
        expect(updateTask).toHaveBeenCalledExactlyOnceWith(
            'pr1', {id: 'design', reviewer: 'a2'}, undefined
        );
    });

    /** The empty word is how a reviewer comes off, so it is passed on rather than read as nothing. */
    test('takes the reviewer off a task on an empty word', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        await updateTaskTool.invoke({
            projectId: 'pr1', taskId: 'design', reviewer: '',
        }, newTestContext());
        expect(updateTask).toHaveBeenCalledExactlyOnceWith(
            'pr1', {id: 'design', reviewer: ''}, undefined
        );
    });

    /**
     * A reviewer no run can be built for is a task that closes by the user's hand alone, so the
     * name is turned away here rather than at the gate it would stand in front of.
     */
    test('refuses a reviewer who does not work here', async () => {
        getAgent.mockReturnValue(undefined);
        await expect(updateTaskTool.invoke({
            projectId: 'pr1', taskId: 'design', reviewer: 'ghost',
        }, newTestContext())).rejects.toThrow('No agent "ghost" works here, pick a reviewer from: a1, a2.');
        expect(updateTask).not.toHaveBeenCalled();
    });

    test('hands new words on to the manager beside the id it looked the task up by', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        await updateTaskTool.invoke({
            projectId: 'pr1', taskId: 'design',
            title: 'design the thing', description: 'sketch it first',
        }, newTestContext());
        expect(updateTask).toHaveBeenCalledExactlyOnceWith(
            'pr1', {id: 'design', title: 'design the thing', description: 'sketch it first'}, undefined
        );
    });

    /**
     * The run goes on. Nothing of the hold resumes when the user verifies -- their word starts the
     * next run like any other -- so the call itself carries all of it: which half of the write went
     * through, that a second attempt goes the same way, and the words to pass on.
     */
    test('leaves the run going when the task still waits for a user verification', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: true});
        const context = newTestContext();
        const result = await updateTaskTool.invoke(
            {projectId: 'pr1', taskId: 'design', status: 'done'}, context
        );
        expect(context.runtime.agentBreakReason).toBeUndefined();
        expect(result).toContain('The status is the one thing of this call that did not go through');
        expect(result).toContain('every later call marking it done');
        expect(result).toContain('nothing to try differently');
        expect(result).toContain('agent.tools.project.awaitVerify');
    });

    test('keeps the loop running when the task was accepted', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        const context = newTestContext();
        const result = await updateTaskTool.invoke(
            {projectId: 'pr1', taskId: 'design', status: 'done'}, context
        );
        expect(context.runtime.agentBreakReason).toBeUndefined();
        expect(result).toContain('Task updated successfully.');
        expect(result).not.toContain('verified');
    });

    test('hands the files of a task over and saves the output with their links', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        mocks.publishGeneratedFiles.mockImplementation((output) => {
            output.content += '\n\n## files\n- [sheet.csv](/api/file/projects/pr1/files/sheet.csv)';
            return {published: ['out/sheet.csv'], skipped: []};
        });
        await updateTaskTool.invoke({
            projectId: 'pr1', taskId: 'design', status: 'done',
            output: {type: 'markdown', content: '# done', generatedFiles: ['out/sheet.csv']},
        }, newTestContext());
        expect(mocks.publishGeneratedFiles).toHaveBeenCalledExactlyOnceWith(
            expect.anything(), ['out/sheet.csv'], projectFilesDir('pr1')
        );
        expect(updateTask).toHaveBeenCalledExactlyOnceWith('pr1', {
            id: 'design',
            status: 'done',
            output: {
                type: 'markdown',
                content: '# done\n\n## files\n- [sheet.csv](/api/file/projects/pr1/files/sheet.csv)',
            },
        }, undefined);
    });

    test('goes looking for no file when the task named none', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        await updateTaskTool.invoke({
            projectId: 'pr1', taskId: 'design', output: {type: 'markdown', content: '# done'},
        }, newTestContext());
        expect(mocks.publishGeneratedFiles).not.toHaveBeenCalled();
    });

    /** A file of the task is handed over from disk, its bytes in the call would only be paid for. */
    test('turns away an output that carries a file instead of words', async () => {
        await expect(updateTaskTool.invoke({
            projectId: 'pr1', taskId: 'ship',
            output: {type: 'binary', content: 'QUJD', generatedFiles: ['out/report.pdf']},
        }, newTestContext())).rejects.toThrow('not the bytes of a file');
        expect(mocks.publishGeneratedFiles).not.toHaveBeenCalled();
        expect(updateTask).not.toHaveBeenCalled();
    });

    /**
     * The run wrote the report a moment ago, and a project of finished tasks carries enough of them
     * to crowd everything else out of the answer, or to have the whole of it truncated.
     */
    test('leaves what the tasks produced out of the answer', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        getProjectDetail.mockReturnValue(newProject({tasks: {
            design: {...newTask('design'), output: {type: 'markdown', content: '# the whole report'}},
        }}));
        const result = await updateTaskTool.invoke(
            {projectId: 'pr1', taskId: 'design', status: 'done'}, newTestContext()
        );
        expect(result).not.toContain('the whole report');
        expect(result).toContain('<Output kept, read it with get_project_detail>');
        // What the output is stays, only the words of it go.
        expect(result).toContain('"type":"markdown"');
    });

    /**
     * An output that was filed away holds the note of that and the path it went to, and reading it
     * back with get_project_detail answers the same: a note about it is longer than what is left.
     */
    test('leaves an output that was filed away as it lies', async () => {
        updateTask.mockReturnValue({task: newTask('ship'), stop: false});
        getProjectDetail.mockReturnValue(newProject({tasks: {
            ship: {...newTask('ship'), output: {
                type: 'markdown',
                content: '<Content saved to file>',
                path: '/api/file/projects/pr1/output/hash1234.md',
            }},
        }}));
        const result = await updateTaskTool.invoke(
            {projectId: 'pr1', taskId: 'ship', status: 'done'}, newTestContext()
        );
        expect(result).toContain('"path":"/api/file/projects/pr1/output/hash1234.md"');
        expect(result).toContain('<Content saved to file>');
        expect(result).not.toContain('<Output kept');
    });

    /** Reading the project back has to answer with the report, whatever a write of it answers. */
    test('leaves the project it read as it found it', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        const project = newProject({tasks: {
            design: {...newTask('design'), output: {type: 'markdown', content: '# the whole report'}},
        }});
        getProjectDetail.mockReturnValue(project);
        await updateTaskTool.invoke(
            {projectId: 'pr1', taskId: 'design', status: 'done'}, newTestContext()
        );
        expect(project.tasks['design']!.output!.content).toBe('# the whole report');
    });

    test('leaves a task without an output as it is', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        getProjectDetail.mockReturnValue(newProject({tasks: {design: newTask('design')}}));
        const result = await updateTaskTool.invoke(
            {projectId: 'pr1', taskId: 'design', status: 'done'}, newTestContext()
        );
        expect(result).toContain(JSON.stringify(newProject({tasks: {design: newTask('design')}})));
    });

    test('says which files never reached the user', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        mocks.publishGeneratedFiles.mockReturnValue({published: [], skipped: ['/tmp/secret.pdf']});
        const result = await updateTaskTool.invoke({
            projectId: 'pr1', taskId: 'design',
            output: {type: 'markdown', content: '# done', generatedFiles: ['/tmp/secret.pdf']},
        }, newTestContext());
        expect(result).toContain('These files were not handed to the user');
        expect(result).toContain('/tmp/secret.pdf');
    });
});

/**
 * The other way a task starts, task_loop being the usual one. Both mark it ongoing; what this adds
 * is the word that the run is the one on it, which stands for the turn it was said in.
 */
describe('workOnTaskTool invoke', () => {

    const context = () => newTestContext();

    beforeEach(() => {
        updateTask.mockReturnValue({task: {...newTask('design'), status: 'ongoing'}, stop: false});
    });

    test('marks the task ongoing on the board', async () => {
        await workOnTaskTool.invoke({projectId: 'pr1', taskId: 'design'}, context());
        expect(updateTask).toHaveBeenCalledExactlyOnceWith('pr1', {id: 'design', status: 'ongoing'});
    });

    test('is running on the board from the moment it was said', async () => {
        await workOnTaskTool.invoke({projectId: 'pr1', taskId: 'design'}, context());
        expect(RunningTaskService.getRunningTasks()).toEqual([{
            runId: expect.any(String), projectId: 'pr1', taskId: 'design',
            agentId: 'a1', kind: 'work', startedAt: expect.any(String),
        }]);
    });

    test('says to the browsers what is running now', async () => {
        const one = context();
        await workOnTaskTool.invoke({projectId: 'pr1', taskId: 'design'}, one);
        expect(one.actions.agentHandler.onInfoEvent).toHaveBeenCalledWith({
            eventType: 'updateRunningTasks',
            content: [expect.objectContaining({projectId: 'pr1', taskId: 'design'})],
        });
    });

    /** One conversation is one thing being answered, and the last word of it is where it is. */
    test('leaves the task before it where the run moves on to another', async () => {
        await workOnTaskTool.invoke({projectId: 'pr1', taskId: 'design'}, context());
        updateTask.mockReturnValue({task: {...newTask('build'), status: 'ongoing'}, stop: false});
        await workOnTaskTool.invoke({projectId: 'pr1', taskId: 'build'}, context());
        expect(RunningTaskService.getRunningTasks())
            .toEqual([expect.objectContaining({taskId: 'build'})]);
    });

    /**
     * A task that is not done is a task this can be said of, and every refusal there is belongs to
     * the board: a task nobody can find, a done task going back to ongoing. Written twice here they
     * would be two answers to one question.
     */
    test('takes nothing on where the board refused the word', async () => {
        updateTask.mockImplementationOnce(() => {
            throw new Error('You can only update the status from todo to ongoing.');
        });
        await expect(workOnTaskTool.invoke({projectId: 'pr1', taskId: 'design'}, context()))
            .rejects.toThrow('You can only update the status');
        expect(RunningTaskService.getRunningTasks()).toEqual([]);
    });

    /**
     * There is no claim to be had on a task, only the fact of who is working it. The run that owns
     * the board and the subagent it handed the task to are the two that can ever reach a task, and
     * both of them working it is both of them doing what they are for.
     */
    test('is said of a task a subagent is on as well', async () => {
        const handedOut = RunningTaskService.startTaskLoopRun({
            projectId: 'pr1', taskId: 'design', agentId: 'a2', startedAt: '2026-08-30T00:00:00.000Z',
        });
        await workOnTaskTool.invoke({projectId: 'pr1', taskId: 'design'}, context());
        expect(RunningTaskService.getRunningTasks()).toEqual([
            expect.objectContaining({runId: handedOut, agentId: 'a2'}),
            expect.objectContaining({agentId: 'a1'}),
        ]);
        RunningTaskService.finishTaskLoopRun(handedOut);
    });

});

describe('updateTaskCurrentStepTool invoke', () => {

    test('streams the new step context and reports it back', async () => {
        const steps: TaskStepsContext = {steps: ['one', 'two'], currentStepIndex: 1};
        updateCurrentStep.mockReturnValue(steps);
        const context = newTestContext();
        const result = await updateTaskCurrentStepTool.invoke(
            {projectId: 'pr1', taskId: 'design', stepIndex: 1}, context
        );
        expect(updateCurrentStep).toHaveBeenCalledExactlyOnceWith('pr1', 'design', 1);
        expect(context.actions.agentHandler.onStreamText).toHaveBeenCalledExactlyOnceWith({
            browserId: 'b1', text: JSON.stringify(steps), tag: 'update_task_current_step',
        });
        expect(context.actions.agentHandler.onInfoEvent).toHaveBeenCalledOnce();
        expect(result).toBe(JSON.stringify(steps));
    });
});

describe('project query tools', () => {

    test('lists the projects for the requested visibility', async () => {
        const list = {projects: {open: [{id: 'pr1', title: 'ship it', description: 'ship the thing'}], closed: []}};
        getProjectList.mockReturnValue(list);
        const result = await getProjectListTool.invoke({includingClosed: true}, newTestContext());
        expect(getProjectList).toHaveBeenCalledExactlyOnceWith(true);
        expect(result).toBe(JSON.stringify(list));
    });

    test('returns a single project as json', async () => {
        const result = await getProjectDetailTool.invoke({projectId: 'pr1'}, newTestContext());
        expect(getProjectDetail).toHaveBeenCalledExactlyOnceWith('pr1');
        expect(result).toBe(JSON.stringify(newProject()));
    });

    /** The standing prompt says notBlockedTasks; a run must not be read the board's name for it. */
    test('hands the tasks nothing blocks over under the name the prompt uses', async () => {
        getProjectDetail.mockReturnValue(newProject({canStartTasks: ['design']}));
        const result = await getProjectDetailTool.invoke({projectId: 'pr1'}, newTestContext());
        expect(result).toContain('"notBlockedTasks":["design"]');
        expect(result).not.toContain('canStartTasks');
    });
});

/**
 * The role says the caller is the run of a project, and this says it is the run of *this* project.
 * Only the second one keeps the board of a project to itself: ids are handed out by
 * get_project_list to anybody who asks, so without it "mark t1 of that other project done" is a
 * thing the run of project A can be talked into and has no way to refuse.
 */
describe('a project reached from the run of another project', () => {

    /** Named the way the tools take it, since it is the argument that is the hole. */
    const other = {projectId: 'pr2'};

    test('is turned away by every tool that writes to a board', async () => {
        const calls: (() => Promise<string>)[] = [
            () => addTaskTool.invoke({
                ...other, id: 'build', title: 'build it', description: 'build', priority: 'high',
            }, newTestContext()),
            () => updateProjectTool.invoke({...other, title: 'ship it faster'}, newTestContext()),
            () => updateTaskTool.invoke({...other, taskId: 'design', status: 'done'}, newTestContext()),
            () => workOnTaskTool.invoke({...other, taskId: 'design'}, newTestContext()),
            () => updateTaskCurrentStepTool.invoke(
                {...other, taskId: 'design', stepIndex: 1}, newTestContext()
            ),
        ];
        for (const call of calls) {
            await expect(call()).rejects.toThrow('pr2 is another project');
        }
        expect(addTask).not.toHaveBeenCalled();
        expect(updateProject).not.toHaveBeenCalled();
        expect(updateTask).not.toHaveBeenCalled();
        expect(updateCurrentStep).not.toHaveBeenCalled();
        expect(RunningTaskService.getRunningTasks()).toEqual([]);
    });

    /**
     * Reading is not writing. A run may be asked what became of another project and answer, which
     * is how a user gets an account of the board without opening every row of it themselves.
     */
    test('is read from anywhere all the same', async () => {
        await expect(getProjectDetailTool.invoke(other, newTestContext())).resolves.toBeTruthy();
        expect(getProjectDetail).toHaveBeenCalledExactlyOnceWith('pr2');
    });
});

describe('project tool metadata', () => {

    /** A subagent reports its work, the loop that assigned the task is the one acting on it. */
    test('a task loop may only move the step index of the task it works', () => {
        expect(createProjectTool.loopKinds).toEqual(['main']);
        expect(updateProjectTool.loopKinds).toEqual(['main']);
        expect(updateTaskTool.loopKinds).toEqual(['main']);
        expect(workOnTaskTool.loopKinds).toEqual(['main']);
        expect(updateTaskCurrentStepTool.loopKinds).toEqual(['main', 'task']);
    });

    function taskIdSchema(tool: {tool: {schema: object}}): {pattern?: string} {
        const schema = tool.tool.schema as
            {properties: {tasks: {items: {properties: {id: {pattern?: string}}}}}};
        return schema.properties.tasks.items.properties.id;
    }

    test('asks a handle of an id being handed out', () => {
        expect(taskIdSchema(createProjectTool).pattern).toBe('^[a-z0-9][a-z0-9_-]*$');
    });

    /**
     * A project made before ids were handed out wears its old task titles as ids. Asking a handle
     * of those on the way back would leave the model nothing to return such a task unchanged as,
     * and an id it makes up instead throws the task away along with everything pointing at it.
     */
    test('takes an id of any shape back through update_project', () => {
        expect(taskIdSchema(updateProjectTool).pattern).toBeUndefined();
    });

    /** Ending the loop mid group would let the siblings of the call run past the stop. */
    test('only the tools that can end the loop run on their own', () => {
        expect(createProjectTool.parallelSafe).toBe(false);
        expect(updateTaskTool.parallelSafe).toBe(false);
        expect(updateProjectTool.parallelSafe).toBe(true);
        expect(updateTaskCurrentStepTool.parallelSafe).toBe(true);
        expect(getProjectListTool.parallelSafe).toBe(true);
        expect(getProjectDetailTool.parallelSafe).toBe(true);
    });
});
