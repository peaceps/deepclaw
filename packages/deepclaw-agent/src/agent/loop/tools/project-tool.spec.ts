import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentIdentity, type Project, type Task, type TaskStepsContext} from '@deepclaw/core';
import {newTestContext} from '../../../test-support/one-loop-context';
import {projectFilesDir} from '../../paths';
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
    return {
        id: 'pr1', title: 'ship it', description: 'ship the thing', tasks: {}, ...overrides,
    } as Project;
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.publishGeneratedFiles.mockReturnValue({published: [], skipped: []});
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

    /** A rename of the project is no reason to read every report of it back. */
    test('leaves what the tasks produced out of the answer', async () => {
        getProjectDetail.mockReturnValue(newProject({tasks: {
            design: {...newTask('design'), output: {type: 'markdown', content: '# the whole report'}},
        }}));
        const result = await updateProjectTool.invoke(
            {projectId: 'pr1', title: 'ship it faster'}, newTestContext()
        );
        expect(result).not.toContain('the whole report');
        expect(result).toContain('<Output kept, read it with get_project_detail>');
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

    test('hands the files of a task over and saves the output with their links', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        mocks.publishGeneratedFiles.mockImplementation((output) => {
            output.content += '\n\n## files\n- [sheet.csv](/api/file/projects/pr1/files/sheet.csv)';
            return {published: ['out/sheet.csv'], skipped: []};
        });
        await updateTaskTool.invoke({
            projectId: 'pr1', taskTitle: 'design', status: 'done',
            output: {type: 'markdown', content: '# done', generatedFiles: ['out/sheet.csv']},
        }, newTestContext());
        expect(mocks.publishGeneratedFiles).toHaveBeenCalledExactlyOnceWith(
            expect.anything(), ['out/sheet.csv'], projectFilesDir('pr1')
        );
        expect(updateTask).toHaveBeenCalledExactlyOnceWith('pr1', {
            title: 'design',
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
            projectId: 'pr1', taskTitle: 'design', output: {type: 'markdown', content: '# done'},
        }, newTestContext());
        expect(mocks.publishGeneratedFiles).not.toHaveBeenCalled();
    });

    /** A file of the task is handed over from disk, its bytes in the call would only be paid for. */
    test('turns away an output that carries a file instead of words', async () => {
        await expect(updateTaskTool.invoke({
            projectId: 'pr1', taskTitle: 'ship',
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
            {projectId: 'pr1', taskTitle: 'design', status: 'done'}, newTestContext()
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
            {projectId: 'pr1', taskTitle: 'ship', status: 'done'}, newTestContext()
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
            {projectId: 'pr1', taskTitle: 'design', status: 'done'}, newTestContext()
        );
        expect(project.tasks['design']!.output!.content).toBe('# the whole report');
    });

    test('leaves a task without an output as it is', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        getProjectDetail.mockReturnValue(newProject({tasks: {design: newTask('design')}}));
        const result = await updateTaskTool.invoke(
            {projectId: 'pr1', taskTitle: 'design', status: 'done'}, newTestContext()
        );
        expect(result).toContain(JSON.stringify(newProject({tasks: {design: newTask('design')}})));
    });

    test('says which files never reached the user', async () => {
        updateTask.mockReturnValue({task: newTask('design'), stop: false});
        mocks.publishGeneratedFiles.mockReturnValue({published: [], skipped: ['/tmp/secret.pdf']});
        const result = await updateTaskTool.invoke({
            projectId: 'pr1', taskTitle: 'design',
            output: {type: 'markdown', content: '# done', generatedFiles: ['/tmp/secret.pdf']},
        }, newTestContext());
        expect(result).toContain('These files were not handed to the user');
        expect(result).toContain('/tmp/secret.pdf');
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

    /** A subagent reports its work, the loop that assigned the task is the one acting on it. */
    test('a task loop may only move the step index of the task it works', () => {
        expect(createProjectTool.loopKinds).toEqual(['main']);
        expect(createSimpleTaskTool.loopKinds).toEqual(['main']);
        expect(updateProjectTool.loopKinds).toEqual(['main']);
        expect(updateTaskTool.loopKinds).toEqual(['main']);
        expect(updateTaskCurrentStepTool.loopKinds).toEqual(['main', 'task']);
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
