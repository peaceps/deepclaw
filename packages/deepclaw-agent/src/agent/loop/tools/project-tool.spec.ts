import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentIdentity, type Project, type Task, type TaskStepsContext} from '@deepclaw/core';
import {newTestContext} from '../../../test-support/one-loop-context';
import {AgentIdentityManager} from '../services/agent-identity-manager';
import {ProjectManager} from '../services/project-manager';
import {
    createProjectTool,
    createSimpleTaskTool,
    getProjectDetailTool,
    getProjectListTool,
    updateProjectTool,
    updateTaskTool,
    updateTaskCurrentStepTool,
} from './project-tool';

vi.mock('@deepclaw/i18n', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/i18n')>()),
    i18nInstance: {t: (key: string) => key},
}));
vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {readDir: vi.fn(() => ({})), writeFile: vi.fn(), exists: vi.fn(() => false)},
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

const createTask = vi.spyOn(ProjectManager, 'createTask');
const createProject = vi.spyOn(ProjectManager, 'createProject');
const updateProject = vi.spyOn(ProjectManager, 'updateProject');
const updateTask = vi.spyOn(ProjectManager, 'updateTask');
const updateCurrentStep = vi.spyOn(ProjectManager, 'updateCurrentStep');
const getProjectList = vi.spyOn(ProjectManager, 'getProjectList');
const getProjectDetail = vi.spyOn(ProjectManager, 'getProjectDetail');
const getAgent = vi.spyOn(AgentIdentityManager, 'getAgent');
const getAgents = vi.spyOn(AgentIdentityManager, 'getAgents');

function newTask(title: string): Task {
    return {title, description: `${title} desc`, priority: 'medium', status: 'todo'} as Task;
}

function newIdentity(id: string, fired = false): AgentIdentity {
    return {id, fired, name: id, role: 'engineer'} as AgentIdentity;
}

function newProject(overrides: Partial<Project> = {}): Project {
    return {id: 'pr1', title: 'ship it', description: 'ship the thing', ...overrides} as Project;
}

beforeEach(() => {
    vi.clearAllMocks();
    createTask.mockImplementation(info => newTask(info.title));
    createProject.mockReturnValue(newProject());
    updateProject.mockReturnValue(newProject());
    getProjectDetail.mockReturnValue(newProject());
    getAgent.mockImplementation(id => newIdentity(id));
    getAgents.mockReturnValue([newIdentity('a1'), newIdentity('a2'), newIdentity('a3', true)]);
});

describe('createProjectTool invoke', () => {

    test('creates every task for the current agent before creating the project', async () => {
        await createProjectTool.invoke({
            title: 'ship it',
            description: 'ship the thing',
            priority: 'high',
            tasks: [
                {title: 'design', description: 'design it', priority: 'medium'},
                {title: 'build', description: 'build it', priority: 'high', blockedBy: ['design']},
            ],
        }, newTestContext());
        expect(createTask).toHaveBeenCalledTimes(2);
        expect(createTask).toHaveBeenNthCalledWith(2, {
            title: 'build', description: 'build it', priority: 'high', blockedBy: ['design'], agentId: 'a1',
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
            tasks: [{title: 'design', description: 'design it', priority: 'medium', assignee: 'a2'}],
        }, newTestContext());
        expect(createTask).toHaveBeenCalledExactlyOnceWith({
            title: 'design', description: 'design it', priority: 'medium', assignee: 'a2', agentId: 'a1',
        });
    });

    /** An id nobody has would send the subagent of the task out as a stranger. */
    test('refuses a task handed to somebody who does not work here', async () => {
        getAgent.mockReturnValue(undefined);
        await expect(createProjectTool.invoke({
            title: 'ship it',
            description: 'ship the thing',
            priority: 'high',
            tasks: [{title: 'design', description: 'design it', priority: 'medium', assignee: 'ghost'}],
        }, newTestContext())).rejects.toThrow('No agent "ghost" works here, assign the task to one of: a1, a2.');
        expect(createProject).not.toHaveBeenCalled();
    });

    test('refuses a task handed to an agent that was fired', async () => {
        getAgent.mockImplementation(id => newIdentity(id, true));
        await expect(createProjectTool.invoke({
            title: 'ship it',
            description: 'ship the thing',
            priority: 'high',
            tasks: [{title: 'design', description: 'design it', priority: 'medium', assignee: 'a3'}],
        }, newTestContext())).rejects.toThrow('No agent "a3" works here');
    });

    test('announces the new project and pauses the loop for a review', async () => {
        const context = newTestContext();
        const result = await createProjectTool.invoke({
            title: 'ship it', description: 'ship the thing', priority: 'high', tasks: [],
        }, context);
        expect(context.actions.agentHandler.onInfoEvent).toHaveBeenCalledExactlyOnceWith({
            eventType: 'updateProject', content: newProject(),
        });
        expect(context.runtime.agentBreakReason).toBe('projectCreated');
        expect(result).toContain('Project created successfully.');
        expect(result).toContain(JSON.stringify(newProject()));
    });
});

describe('createSimpleTaskTool invoke', () => {

    test('wraps the single task into a project that mirrors it', async () => {
        const context = newTestContext();
        const result = await createSimpleTaskTool.invoke(
            {title: 'fix bug', description: 'fix the bug', priority: 'urgent', steps: ['repro', 'patch']}, context
        );
        expect(createTask).toHaveBeenCalledExactlyOnceWith({
            title: 'fix bug', description: 'fix the bug', priority: 'urgent',
            steps: ['repro', 'patch'], agentId: 'a1',
        });
        expect(createProject).toHaveBeenCalledExactlyOnceWith(
            {agentId: 'a1', title: 'fix bug', description: 'fix bug desc', priority: 'medium'},
            [newTask('fix bug')]
        );
        expect(context.runtime.agentBreakReason).toBe('projectCreated');
        expect(result).toContain('Task created successfully.');
    });
});

describe('updateProjectTool invoke', () => {

    test('patches the project without rebuilding its tasks', async () => {
        await updateProjectTool.invoke({projectId: 'pr1', title: 'ship it faster'}, newTestContext());
        expect(createTask).not.toHaveBeenCalled();
        expect(updateProject).toHaveBeenCalledExactlyOnceWith({id: 'pr1', title: 'ship it faster'}, undefined);
    });

    test('rebuilds the task list when new tasks are given', async () => {
        await updateProjectTool.invoke({
            projectId: 'pr1',
            tasks: [{title: 'design', description: 'design it', priority: 'low'}],
        }, newTestContext());
        expect(updateProject).toHaveBeenCalledExactlyOnceWith({id: 'pr1'}, [newTask('design')]);
    });

    test('keeps the assignee of every rebuilt task', async () => {
        await updateProjectTool.invoke({
            projectId: 'pr1',
            tasks: [{title: 'design', description: 'design it', priority: 'low', assignee: 'a2'}],
        }, newTestContext());
        expect(createTask).toHaveBeenCalledExactlyOnceWith({
            title: 'design', description: 'design it', priority: 'low', assignee: 'a2', agentId: 'a1',
        });
    });

    test('refuses a rebuilt task handed to somebody who does not work here', async () => {
        getAgent.mockReturnValue(undefined);
        await expect(updateProjectTool.invoke({
            projectId: 'pr1',
            tasks: [{title: 'design', description: 'design it', priority: 'low', assignee: 'ghost'}],
        }, newTestContext())).rejects.toThrow('No agent "ghost" works here');
        expect(updateProject).not.toHaveBeenCalled();
    });

    test('reports the project back and notifies the ui', async () => {
        const context = newTestContext();
        const result = await updateProjectTool.invoke({projectId: 'pr1'}, context);
        expect(context.actions.agentHandler.onInfoEvent).toHaveBeenCalledExactlyOnceWith({
            eventType: 'updateProject', content: newProject(),
        });
        expect(result).toContain('Project updated successfully.');
        expect(context.runtime.agentBreakReason).toBeUndefined();
    });
});

describe('updateTaskTool invoke', () => {

    test('only forwards the optional fields that were provided', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        await updateTaskTool.invoke({projectId: 'pr1', taskTitle: 'design', status: 'ongoing'}, newTestContext());
        expect(updateTask).toHaveBeenCalledExactlyOnceWith(
            'pr1', {title: 'design', status: 'ongoing'}, undefined
        );
    });

    test('passes assignee, output and steps through to the manager', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        const output = {type: 'markdown' as const, content: '# done'};
        await updateTaskTool.invoke({
            projectId: 'pr1', taskTitle: 'design', assignee: 'a2', output, steps: ['one', 'two'],
        }, newTestContext());
        expect(updateTask).toHaveBeenCalledExactlyOnceWith(
            'pr1', {title: 'design', assignee: 'a2', output}, ['one', 'two']
        );
    });

    test('refuses to reassign a task to somebody who does not work here', async () => {
        getAgent.mockReturnValue(undefined);
        await expect(updateTaskTool.invoke(
            {projectId: 'pr1', taskTitle: 'design', assignee: 'ghost'}, newTestContext()
        )).rejects.toThrow('No agent "ghost" works here');
        expect(updateTask).not.toHaveBeenCalled();
    });

    test('breaks the loop when the task still waits for a user verification', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: true});
        const context = newTestContext();
        const result = await updateTaskTool.invoke(
            {projectId: 'pr1', taskTitle: 'design', status: 'done'}, context
        );
        expect(context.runtime.agentBreakReason).toBe('taskPause');
        expect(context.runtime.agentBreakDetail).toBe('agent.agentBreak.agentStop.taskPause.user');
        expect(result).toContain('Task is not set done because the user requires it to be verified');
    });

    test('keeps the loop running when the task was accepted', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        const context = newTestContext();
        const result = await updateTaskTool.invoke(
            {projectId: 'pr1', taskTitle: 'design', status: 'done'}, context
        );
        expect(context.runtime.agentBreakReason).toBeUndefined();
        expect(result).toContain('Task updated successfully.');
        expect(result).not.toContain('verified');
    });
});

describe('updateTaskCurrentStepTool invoke', () => {

    test('streams the new step context and reports it back', async () => {
        const steps: TaskStepsContext = {steps: ['one', 'two'], currentStepIndex: 1};
        updateCurrentStep.mockReturnValue(steps);
        const context = newTestContext();
        const result = await updateTaskCurrentStepTool.invoke(
            {projectId: 'pr1', taskTitle: 'design', stepIndex: 1}, context
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
});

describe('project tool metadata', () => {

    /** A sub loop reports its work, the loop that assigned the task is the one acting on it. */
    test('a sub loop may only move the step index of a task', () => {
        expect(createProjectTool.exclusiveInSubLoop).toBe(true);
        expect(createSimpleTaskTool.exclusiveInSubLoop).toBe(true);
        expect(updateProjectTool.exclusiveInSubLoop).toBe(true);
        expect(updateTaskTool.exclusiveInSubLoop).toBe(true);
        expect(updateTaskCurrentStepTool.exclusiveInSubLoop).toBe(false);
    });

    /** Ending the loop mid group would let the siblings of the call run past the stop. */
    test('only the tools that can end the loop run on their own', () => {
        expect(createProjectTool.parallelSafe).toBe(false);
        expect(createSimpleTaskTool.parallelSafe).toBe(false);
        expect(updateTaskTool.parallelSafe).toBe(false);
        expect(updateProjectTool.parallelSafe).toBe(true);
        expect(updateTaskCurrentStepTool.parallelSafe).toBe(true);
        expect(getProjectListTool.parallelSafe).toBe(true);
        expect(getProjectDetailTool.parallelSafe).toBe(true);
    });
});
