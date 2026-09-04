import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {
    type AgentEmployee, type AgentSoulIdentity, type ArchivedProjectsAsk,
    type ArchivedProjectsPage, type CronJobHistory, type WorkingDirRefusal,
} from '@deepclaw/core';
import {type SkillInfo} from '@deepclaw/loop-gateway';
import {type UpdateContent} from '@deepclaw/utils';
import {
    type TaskEdit,
    deleteArchivedProject, finishProjectTask, getActiveAgents, getArchivedProjects, getCronHistories,
    getSkills, restoreProject, setSkillAgents, takeUpProjectTask, updateAgentIdentity,
    editCronTask, editProjectReport, editTaskReport, updateCronTaskStatus,
    setProjectWorkingDir, updateProjectDescription, updateProjectTags, updateProjectTask,
} from './data';

const mocks = vi.hoisted(() => ({
    updateAgentIdentity: vi.fn<(identity: object) => void>(),
    updateProjectTags: vi.fn<(projectId: string, tags: string[]) => void>(),
    updateProjectDescription: vi.fn<(projectId: string, description: string) => void>(),
    setProjectWorkingDir: vi.fn<
        (projectId: string, workingDir: string, create?: boolean) => WorkingDirRefusal | undefined
    >(),
    updateProjectTask: vi.fn<(projectId: string, task: object) => void>(),
    takeUpProjectTask: vi.fn<(projectId: string, taskId: string) => void>(),
    finishProjectTask: vi.fn<(projectId: string, taskId: string) => void>(),
    editTaskReport: vi.fn<
        (projectId: string, taskId: string, content: string) => 'working' | undefined
    >(),
    editProjectReport: vi.fn<(projectId: string, content: string) => void>(),
    getDataInfo: vi.fn<() => {agents: AgentEmployee[]}>(),
    getSkills: vi.fn<() => SkillInfo[]>(),
    setSkillAgents: vi.fn<(name: string, agentIds?: string[]) => void>(),
    getCronHistories: vi.fn<(id: string, beforeStart: number, limit?: number) => CronJobHistory[]>(),
    listArchivedProjects: vi.fn<(ask: ArchivedProjectsAsk) => ArchivedProjectsPage>(),
    restoreProject: vi.fn<(projectId: string) => void>(),
    deleteArchivedProject: vi.fn<(projectId: string) => void>(),
    updateCronTaskStatus: vi.fn<(id: string, pause?: boolean, close?: boolean) => void>(),
    updateCronTask: vi.fn<(id: string, fields: {title?: string; cron?: string; prompt?: string}) => void>(),
    revalidatePath: vi.fn<(path: string, type: string) => void>(),
}));

vi.mock('@deepclaw/loop-gateway', () => ({
    LoopGateway: {
        updateAgentIdentity: mocks.updateAgentIdentity,
        updateProjectTags: mocks.updateProjectTags,
        updateProjectDescription: mocks.updateProjectDescription,
        setProjectWorkingDir: mocks.setProjectWorkingDir,
        updateProjectTask: mocks.updateProjectTask,
        takeUpProjectTask: mocks.takeUpProjectTask,
        finishProjectTask: mocks.finishProjectTask,
        editTaskReport: mocks.editTaskReport,
        editProjectReport: mocks.editProjectReport,
        getDataInfo: mocks.getDataInfo,
        getSkills: mocks.getSkills,
        setSkillAgents: mocks.setSkillAgents,
        getCronHistories: mocks.getCronHistories,
        listArchivedProjects: mocks.listArchivedProjects,
        restoreProject: mocks.restoreProject,
        deleteArchivedProject: mocks.deleteArchivedProject,
        updateCronTaskStatus: mocks.updateCronTaskStatus,
        updateCronTask: mocks.updateCronTask,
    },
}));

vi.mock('next/cache', () => ({revalidatePath: mocks.revalidatePath}));

function newEmployee(overrides: Partial<AgentEmployee> = {}): AgentEmployee {
    return {
        id: 'a1',
        name: 'Ada',
        fired: false,
        description: 'does things',
        avatar: '🦊',
        role: 'engineer',
        personalities: [],
        emotion: false,
        expertises: [],
        mood: 'none',
        ...overrides,
    };
}

function newIdentity(avatar?: string): UpdateContent<AgentSoulIdentity> {
    return avatar === undefined ? {id: 'a1', role: 'boss'} : {id: 'a1', avatar};
}

function newTask(): TaskEdit {
    return {id: 'ship-it', title: 'ship it'};
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('updateAgentIdentity', () => {

    test('stores the patch and revalidates the layout', async () => {
        await updateAgentIdentity(newIdentity());
        expect(mocks.updateAgentIdentity).toHaveBeenCalledWith({id: 'a1', role: 'boss'});
        expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
    });

    test('accepts an avatar of sixteen characters', async () => {
        await updateAgentIdentity(newIdentity('x'.repeat(16)));
        expect(mocks.updateAgentIdentity).toHaveBeenCalledOnce();
    });

    test('rejects an avatar longer than sixteen characters', async () => {
        await expect(updateAgentIdentity(newIdentity('x'.repeat(17)))).rejects.toThrow('Invalid avatar');
        expect(mocks.updateAgentIdentity).not.toHaveBeenCalled();
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    test('ignores the avatar rule for a patch without an avatar', async () => {
        await updateAgentIdentity({id: 'a1', avatar: ''});
        expect(mocks.updateAgentIdentity).toHaveBeenCalledOnce();
    });

    test('reports a failing gateway and does not revalidate', async () => {
        mocks.updateAgentIdentity.mockImplementation(() => {
            throw new Error('gateway down');
        });
        await expect(updateAgentIdentity(newIdentity())).rejects.toThrow('gateway down');
        expect(console.error).toHaveBeenCalledWith('Error saving agent identity:', expect.any(Error));
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
});

describe('updateProjectTags', () => {

    test('stores the tags and revalidates the layout', async () => {
        await updateProjectTags('p1', ['urgent']);
        expect(mocks.updateProjectTags).toHaveBeenCalledWith('p1', ['urgent']);
        expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
    });

    test('passes an empty tag list on', async () => {
        await updateProjectTags('p1', []);
        expect(mocks.updateProjectTags).toHaveBeenCalledWith('p1', []);
    });

    test('reports a failing gateway', async () => {
        mocks.updateProjectTags.mockImplementation(() => {
            throw new Error('gateway down');
        });
        await expect(updateProjectTags('p1', ['urgent'])).rejects.toThrow('gateway down');
        expect(console.error).toHaveBeenCalledWith('Error saving project tags:', expect.any(Error));
    });
});

describe('updateProjectDescription', () => {

    test('stores the description and revalidates the layout', async () => {
        await updateProjectDescription('p1', 'a shop that sells hats');
        expect(mocks.updateProjectDescription).toHaveBeenCalledWith('p1', 'a shop that sells hats');
        expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
    });

    /** The box the user writes in reads an empty save as a cancel, and so does this. */
    test('refuses a description of nothing at all', async () => {
        await expect(updateProjectDescription('p1', '   ')).rejects.toThrow('needs a description');
        expect(mocks.updateProjectDescription).not.toHaveBeenCalled();
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    test('reports a failing gateway', async () => {
        mocks.updateProjectDescription.mockImplementation(() => {
            throw new Error('gateway down');
        });
        await expect(updateProjectDescription('p1', 'a shop')).rejects.toThrow('gateway down');
        expect(console.error)
            .toHaveBeenCalledWith('Error saving project description:', expect.any(Error));
    });
});

describe('setProjectWorkingDir', () => {

    test('stores the folder and revalidates the layout', async () => {
        expect(await setProjectWorkingDir('p1', '/home/someone/code/app')).toBeUndefined();
        expect(mocks.setProjectWorkingDir)
            .toHaveBeenCalledWith('p1', '/home/someone/code/app', false);
        expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
    });

    /** Emptying the box is meant here: the project goes back to working beside the data. */
    test('takes the folder off the project for an empty word', async () => {
        await setProjectWorkingDir('p1', '');
        expect(mocks.setProjectWorkingDir).toHaveBeenCalledWith('p1', '', false);
    });

    /**
     * A folder that is not there comes back as itself, the browser having a question to put to the
     * user about it, and it comes back naming the folder: what they typed is not a path yet, and a
     * question about their words is a yes to a folder nobody showed them. A throw would reach them
     * as a digest with none of the words in it.
     */
    test('answers with what turned the folder away and revalidates nothing', async () => {
        mocks.setProjectWorkingDir.mockReturnValue({reason: 'missing', dir: '/home/someone/typo'});
        expect(await setProjectWorkingDir('p1', '~/typo'))
            .toEqual({reason: 'missing', dir: '/home/someone/typo'});
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    test('passes the word to make the folder along', async () => {
        await setProjectWorkingDir('p1', '/home/someone/code/app', true);
        expect(mocks.setProjectWorkingDir)
            .toHaveBeenCalledWith('p1', '/home/someone/code/app', true);
    });

    test('reports a failing gateway', async () => {
        mocks.setProjectWorkingDir.mockImplementation(() => {
            throw new Error('gateway down');
        });
        await expect(setProjectWorkingDir('p1', '/home/someone/code/app'))
            .rejects.toThrow('gateway down');
        expect(console.error)
            .toHaveBeenCalledWith('Error saving project working dir:', expect.any(Error));
    });
});

describe('updateProjectTask', () => {

    test('stores the task and revalidates the layout', async () => {
        await updateProjectTask('p1', newTask());
        expect(mocks.updateProjectTask).toHaveBeenCalledWith('p1', newTask());
        expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
    });

    test('carries a pause and a verdict on', async () => {
        await updateProjectTask('p1', {id: 'ship-it', pause: true, verified: false});
        expect(mocks.updateProjectTask)
            .toHaveBeenCalledWith('p1', {id: 'ship-it', pause: true, verified: false});
    });

    test('carries the agent a task was handed to on', async () => {
        await updateProjectTask('p1', {id: 'ship-it', assignee: 'a2'});
        expect(mocks.updateProjectTask).toHaveBeenCalledWith('p1', {id: 'ship-it', assignee: 'a2'});
    });

    test('carries a priority picked off the pill on', async () => {
        await updateProjectTask('p1', {id: 'ship-it', priority: 'urgent'});
        expect(mocks.updateProjectTask).toHaveBeenCalledWith('p1', {id: 'ship-it', priority: 'urgent'});
    });

    /** The board writes what a card offers, whatever else a request to this action carried. */
    test('drops what no card on the board may write', async () => {
        await updateProjectTask('p1', {
            id: 'ship-it', title: 'ship it',
            output: {type: 'text', content: 'shipped'},
        } as unknown as TaskEdit);
        expect(mocks.updateProjectTask).toHaveBeenCalledWith('p1', {id: 'ship-it', title: 'ship it'});
    });

    /**
     * Moving a task on is more than one write either way and each has a door of its own, so no
     * status comes through this one -- whatever a request that never read the type sends.
     */
    test('drops a status, whichever one it is', async () => {
        for (const status of ['ongoing', 'done', 'todo', 'whenever']) {
            await updateProjectTask('p1', {id: 'ship-it', status} as unknown as TaskEdit);
            expect(mocks.updateProjectTask).toHaveBeenLastCalledWith('p1', {id: 'ship-it'});
        }
    });

    test('reports a failing gateway', async () => {
        mocks.updateProjectTask.mockImplementation(() => {
            throw new Error('gateway down');
        });
        await expect(updateProjectTask('p1', newTask())).rejects.toThrow('gateway down');
        expect(console.error).toHaveBeenCalledWith('Error saving project task:', expect.any(Error));
    });
});

describe('takeUpProjectTask', () => {

    test('takes the task up by id and revalidates the layout', async () => {
        await takeUpProjectTask('p1', 'ship-it');
        expect(mocks.takeUpProjectTask).toHaveBeenCalledWith('p1', 'ship-it');
        expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
    });

    test('reports a failing gateway and does not revalidate', async () => {
        mocks.takeUpProjectTask.mockImplementation(() => {
            throw new Error('Only a task still in todo can be taken up.');
        });
        await expect(takeUpProjectTask('p1', 'ship-it')).rejects.toThrow('still in todo');
        expect(console.error)
            .toHaveBeenCalledWith('Error taking up project task:', expect.any(Error));
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
});

describe('finishProjectTask', () => {

    test('closes the task by id and revalidates the layout', async () => {
        await finishProjectTask('p1', 'ship-it');
        expect(mocks.finishProjectTask).toHaveBeenCalledWith('p1', 'ship-it');
        expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
    });

    test('reports a failing gateway and does not revalidate', async () => {
        mocks.finishProjectTask.mockImplementation(() => {
            throw new Error('a subagent is working on this task');
        });
        await expect(finishProjectTask('p1', 'ship-it')).rejects.toThrow('a subagent is working');
        expect(console.error)
            .toHaveBeenCalledWith('Error finishing project task:', expect.any(Error));
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
});

describe('reports the user rewrote', () => {

    test('sends the whole of a task report and revalidates the layout', async () => {
        expect(await editTaskReport('p1', 'ship-it', '# it went well')).toBeUndefined();
        expect(mocks.editTaskReport).toHaveBeenCalledWith('p1', 'ship-it', '# it went well');
        expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
    });

    /** The browser has a sentence of its own for this one, which a thrown message would not reach. */
    test('hands back what turned a task report away, and revalidates nothing', async () => {
        mocks.editTaskReport.mockReturnValue('working');
        expect(await editTaskReport('p1', 'ship-it', 'words')).toBe('working');
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    test('reports a task report the gateway threw over and does not revalidate', async () => {
        mocks.editTaskReport.mockImplementation(() => {
            throw new Error('the project folder is read only');
        });
        await expect(editTaskReport('p1', 'ship-it', 'words')).rejects.toThrow('read only');
        expect(console.error).toHaveBeenCalledWith('Error saving task report:', expect.any(Error));
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    test('sends the whole of a project report and revalidates the layout', async () => {
        await editProjectReport('p1', '# it all went well');
        expect(mocks.editProjectReport).toHaveBeenCalledWith('p1', '# it all went well');
        expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
    });

    test('reports a project report the gateway refused and does not revalidate', async () => {
        mocks.editProjectReport.mockImplementation(() => {
            throw new Error('this project has no report to rewrite');
        });
        await expect(editProjectReport('p1', 'words')).rejects.toThrow('no report to rewrite');
        expect(console.error).toHaveBeenCalledWith('Error saving project report:', expect.any(Error));
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
});

describe('getActiveAgents', () => {

    test('names only the agents that were not fired', async () => {
        mocks.getDataInfo.mockReturnValue({
            agents: [newEmployee(), newEmployee({id: 'a2', name: 'Bob', fired: true})],
        });
        await expect(getActiveAgents()).resolves.toEqual([{id: 'a1', name: 'Ada'}]);
    });

    test('reduces an agent to its id and name', async () => {
        mocks.getDataInfo.mockReturnValue({agents: [newEmployee({role: 'boss', mood: 'happy'})]});
        await expect(getActiveAgents()).resolves.toEqual([{id: 'a1', name: 'Ada'}]);
    });

    test('returns nothing when every agent was fired', async () => {
        mocks.getDataInfo.mockReturnValue({agents: [newEmployee({fired: true})]});
        await expect(getActiveAgents()).resolves.toEqual([]);
    });
});

describe('skills', () => {

    test('reads the skills from the gateway', async () => {
        const skills = [{name: 'search'}] as SkillInfo[];
        mocks.getSkills.mockReturnValue(skills);
        await expect(getSkills()).resolves.toBe(skills);
    });

    test('assigns a skill to the given agents and revalidates the layout', async () => {
        await setSkillAgents('search', ['a1']);
        expect(mocks.setSkillAgents).toHaveBeenCalledWith('search', ['a1']);
        expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
    });

    test('unassigns a skill when no agent is named', async () => {
        await setSkillAgents('search');
        expect(mocks.setSkillAgents).toHaveBeenCalledWith('search', undefined);
    });

    test('reports a failing gateway', async () => {
        mocks.setSkillAgents.mockImplementation(() => {
            throw new Error('gateway down');
        });
        await expect(setSkillAgents('search', ['a1'])).rejects.toThrow('gateway down');
        expect(console.error).toHaveBeenCalledWith('Error setting skill agents:', expect.any(Error));
    });
});

describe('getArchivedProjects', () => {

    const ask = {query: 'parser', owner: 'a1', offset: 20};

    test('hands the ask to the gateway and answers with the page', async () => {
        const page = {projects: [], owners: [{id: 'a1', count: 3}], total: 3};
        mocks.listArchivedProjects.mockReturnValue(page);
        await expect(getArchivedProjects(ask)).resolves.toBe(page);
        expect(mocks.listArchivedProjects).toHaveBeenCalledWith(ask);
    });

    /** Nothing is written by a look through the archive, so there is nothing for a page to revalidate. */
    test('revalidates nothing', async () => {
        mocks.listArchivedProjects.mockReturnValue({projects: [], owners: [], total: 0});
        await getArchivedProjects(ask);
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    test('reports a failing gateway', async () => {
        mocks.listArchivedProjects.mockImplementation(() => {
            throw new Error('gateway down');
        });
        await expect(getArchivedProjects(ask)).rejects.toThrow('gateway down');
        expect(console.error)
            .toHaveBeenCalledWith('Error reading the archived projects:', expect.any(Error));
    });
});

describe('restoreProject', () => {

    /** The project is on a board again, so every page reading one has something new to draw. */
    test('puts the project back and revalidates the layout', async () => {
        await restoreProject('p1');
        expect(mocks.restoreProject).toHaveBeenCalledWith('p1');
        expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
    });

    test('reports a failing gateway', async () => {
        mocks.restoreProject.mockImplementation(() => {
            throw new Error('gateway down');
        });
        await expect(restoreProject('p1')).rejects.toThrow('gateway down');
        expect(console.error).toHaveBeenCalledWith('Error restoring project:', expect.any(Error));
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
});

describe('deleteArchivedProject', () => {

    /** Nothing a page starts with held this project: it left the board when it was put away. */
    test('deletes the project and revalidates nothing', async () => {
        await deleteArchivedProject('p1');
        expect(mocks.deleteArchivedProject).toHaveBeenCalledWith('p1');
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    test('reports a failing gateway', async () => {
        mocks.deleteArchivedProject.mockImplementation(() => {
            throw new Error('gateway down');
        });
        await expect(deleteArchivedProject('p1')).rejects.toThrow('gateway down');
        expect(console.error)
            .toHaveBeenCalledWith('Error deleting the archived project:', expect.any(Error));
    });
});

describe('cron tasks', () => {

    test('passes the history cursor and the page size on', async () => {
        mocks.getCronHistories.mockReturnValue([]);
        await getCronHistories('c1', 1234, 10);
        expect(mocks.getCronHistories).toHaveBeenCalledWith('c1', 1234, 10);
    });

    test('leaves the page size to the gateway', async () => {
        mocks.getCronHistories.mockReturnValue([]);
        await getCronHistories('c1', 1234);
        expect(mocks.getCronHistories).toHaveBeenCalledWith('c1', 1234, undefined);
    });

    test('pauses a task and revalidates the layout', async () => {
        await updateCronTaskStatus('c1', true);
        expect(mocks.updateCronTaskStatus).toHaveBeenCalledWith('c1', true, undefined);
        expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
    });

    test('closes a task', async () => {
        await updateCronTaskStatus('c1', false, true);
        expect(mocks.updateCronTaskStatus).toHaveBeenCalledWith('c1', false, true);
    });

    test('reports a failing gateway', async () => {
        mocks.updateCronTaskStatus.mockImplementation(() => {
            throw new Error('gateway down');
        });
        await expect(updateCronTaskStatus('c1', true)).rejects.toThrow('gateway down');
        expect(console.error).toHaveBeenCalledWith('Error updating cron task status:', expect.any(Error));
    });

    test('edits a task and revalidates the layout', async () => {
        await editCronTask('c1', {title: 'weekly', cron: '0 0 * * 0'});
        expect(mocks.updateCronTask).toHaveBeenCalledWith('c1', {title: 'weekly', cron: '0 0 * * 0'});
        expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
    });

    test('reports a failing edit', async () => {
        mocks.updateCronTask.mockImplementation(() => {
            throw new Error('bad cron');
        });
        await expect(editCronTask('c1', {cron: 'not a cron'})).rejects.toThrow('bad cron');
        expect(console.error).toHaveBeenCalledWith('Error editing cron task:', expect.any(Error));
    });
});
