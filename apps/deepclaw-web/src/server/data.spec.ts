import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {
    type AgentEmployee, type AgentSoulIdentity, type CronJobHistory,
} from '@deepclaw/core';
import {type SkillInfo} from '@deepclaw/loop-gateway';
import {type UpdateContent} from '@deepclaw/utils';
import {
    type TaskEdit,
    getActiveAgents, getCronHistories, getSkills, setSkillAgents,
    updateAgentIdentity, updateCronTaskStatus, updateProjectDescription, updateProjectTags,
    updateProjectTask,
} from './data';

const mocks = vi.hoisted(() => ({
    updateAgentIdentity: vi.fn<(identity: object) => void>(),
    updateProjectTags: vi.fn<(projectId: string, tags: string[]) => void>(),
    updateProjectDescription: vi.fn<(projectId: string, description: string) => void>(),
    updateProjectTask: vi.fn<(projectId: string, task: object) => void>(),
    getDataInfo: vi.fn<() => {agents: AgentEmployee[]}>(),
    getSkills: vi.fn<() => SkillInfo[]>(),
    setSkillAgents: vi.fn<(name: string, agentIds?: string[]) => void>(),
    getCronHistories: vi.fn<(id: string, beforeStart: number, limit?: number) => CronJobHistory[]>(),
    updateCronTaskStatus: vi.fn<(id: string, pause?: boolean, close?: boolean) => void>(),
    revalidatePath: vi.fn<(path: string, type: string) => void>(),
}));

vi.mock('@deepclaw/loop-gateway', () => ({
    LoopGateway: {
        updateAgentIdentity: mocks.updateAgentIdentity,
        updateProjectTags: mocks.updateProjectTags,
        updateProjectDescription: mocks.updateProjectDescription,
        updateProjectTask: mocks.updateProjectTask,
        getDataInfo: mocks.getDataInfo,
        getSkills: mocks.getSkills,
        setSkillAgents: mocks.setSkillAgents,
        getCronHistories: mocks.getCronHistories,
        updateCronTaskStatus: mocks.updateCronTaskStatus,
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

    /** The board writes what a card offers, whatever else a request to this action carried. */
    test('drops what no card on the board may write', async () => {
        await updateProjectTask('p1', {
            id: 'ship-it', title: 'ship it', status: 'done',
            output: {type: 'text', content: 'shipped'},
        } as TaskEdit);
        expect(mocks.updateProjectTask).toHaveBeenCalledWith('p1', {id: 'ship-it', title: 'ship it'});
    });

    test('reports a failing gateway', async () => {
        mocks.updateProjectTask.mockImplementation(() => {
            throw new Error('gateway down');
        });
        await expect(updateProjectTask('p1', newTask())).rejects.toThrow('gateway down');
        expect(console.error).toHaveBeenCalledWith('Error saving project task:', expect.any(Error));
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
});
