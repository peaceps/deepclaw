import process from 'node:process';
import {describe, expect, test, vi} from 'vitest';
import {type AgentIdentity, type CronTask, type Task} from '@deepclaw/core';
import {newTestAgentConfig} from '../../../test-support/one-loop-context';

const mocks = vi.hoisted(() => ({
    loadLang: vi.fn<() => string>(),
    readFile: vi.fn<(filePath: string) => string>(),
    readDir: vi.fn<(dirPath: string) => {[key: string]: {dir: string, content: string}}>(),
    exists: vi.fn<(filePath: string) => boolean>(),
}));

vi.mock('@deepclaw/config', () => ({loadLang: mocks.loadLang}));
vi.mock('@deepclaw/i18n', () => ({FULL_NAME_MAP: {en: 'English', zh: 'Chinese'}}));
vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {readFile: mocks.readFile, readDir: mocks.readDir, exists: mocks.exists},
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    getLoopLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

const BUILT_IN_IDENTITY = 'You are a helpful and efficient assistant for the user.';

/**
 * The platform, language and identity blocks are built while the class is initialized, so every
 * test reloads the module after arranging its mocks. The sibling services are replaced by spies
 * on the freshly loaded classes; the empty file system mock keeps their own loading harmless.
 */
async function loadService(setup: () => void = () => undefined) {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.loadLang.mockReturnValue('en');
    mocks.readDir.mockReturnValue({});
    mocks.exists.mockReturnValue(false);
    mocks.readFile.mockImplementation((filePath: string) => {
        throw new Error(`File ${filePath} not found.`);
    });
    setup();
    const {PromptService} = await import('./prompt-service');
    const {MemoryManager} = await import('./memory-manager');
    const {SkillsManager} = await import('./skills-manager');
    const {ProjectManager} = await import('./project-manager');
    const {CronService} = await import('./cron-service');
    const {AgentIdentityManager} = await import('./agent-identity-manager');
    return {
        PromptService,
        getTask: vi.spyOn(ProjectManager, 'getTask').mockReturnValue(undefined),
        assignedTaskPrompt: vi.spyOn(ProjectManager, 'promptAssignedTask')
            .mockReturnValue('the assigned task'),
        getAgent: vi.spyOn(AgentIdentityManager, 'getAgent').mockReturnValue(undefined),
        memoryPrompt: vi.spyOn(MemoryManager, 'getMemoryPrompt').mockReturnValue('the memory prompt'),
        skillPrompt: vi.spyOn(SkillsManager, 'generateSkillPrompt').mockReturnValue('the skills prompt'),
        currentProject: vi.spyOn(ProjectManager, 'promptCurrentProject')
            .mockReturnValue('the current project'),
        managementTools: vi.spyOn(ProjectManager, 'promptManagementTools')
            .mockReturnValue('the project tools'),
        taskDelegation: vi.spyOn(ProjectManager, 'promptTaskDelegation')
            .mockReturnValue('hand the tasks over'),
        cronTaskDetail: vi.spyOn(CronService, 'getCronTaskDetail')
            .mockReturnValue({id: 'c1', title: 'nightly report', cron: '0 9 * * *'} as CronTask),
    };
}

/** Pays the transform of the module graph while the file loads, out of reach of a test timeout. */
await loadService();

function newIdentity(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
    return {
        id: 'a1',
        avatar: '🐟',
        role: 'engineer',
        personalities: ['calm', 'curious'],
        emotion: true,
        expertises: ['typescript'],
        name: 'Ada',
        fired: false,
        description: 'the agent who ships',
        ...overrides,
    };
}

describe('platform and language', () => {

    test('tells the model which platform and folder it works in', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', false);
        const platform = process.platform.includes('win32') ? 'Windows' : 'Linux';
        expect(cacheable).toContain(`You are a worker on ${platform} platform working in "${process.cwd()}".`);
    });

    test('asks the model to answer in the configured language', async () => {
        const {PromptService} = await loadService(() => mocks.loadLang.mockReturnValue('zh'));
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', false);
        expect(cacheable).toContain('User set Chinese as the preferred language, please answer in Chinese');
    });

    test('picks up a language that changed between two prompts', async () => {
        const {PromptService} = await loadService();
        PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', false);
        mocks.loadLang.mockReturnValue('zh');
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', false);
        expect(cacheable).toContain('please answer in Chinese');
        expect(cacheable).not.toContain('please answer in English');
    });

    test('starts the cacheable prompt with the platform section', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', false);
        expect(cacheable.startsWith('\n# Platform\n')).toBe(true);
    });

    test('keeps the sections in a stable order', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', false);
        expect(cacheable.split('\n').filter(line => line.startsWith('# '))).toEqual([
            '# Platform', '# Language', '# Main Identity', '# Personality', '# Emotions',
            '# Agent Mode', '# Project Management', '# Memory', '# Skills',
        ]);
    });
});

describe('main identity', () => {

    test('uses the content of DEEPCLAW.md as the shared identity', async () => {
        const {PromptService} = await loadService(
            () => mocks.readFile.mockReturnValue('you are the house agent')
        );
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', false);
        expect(mocks.readFile).toHaveBeenCalledWith('DEEPCLAW.md');
        expect(cacheable).toContain('you are the house agent');
    });

    test('falls back to the built in identity when DEEPCLAW.md cannot be read', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', false);
        expect(cacheable).toContain(BUILT_IN_IDENTITY);
    });

    test('adds the sub loop rules for a sub loop', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', true);
        expect(cacheable).toContain('you are a subloop agent for specific task described in the prompt');
        expect(cacheable).toContain('You can write files and run commands to carry the task out');
        expect(cacheable).toContain('never ask a question');
    });

    test('adds the autonomous rules for a cron loop', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'cron', 'c1', false);
        expect(cacheable).toContain('you are running as a scheduled (cron) task');
        expect(cacheable).toContain('never ask clarifying questions');
    });

    test('gives a main loop the plain identity only', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', false);
        expect(cacheable).not.toContain('you are a subloop agent');
        expect(cacheable).not.toContain('scheduled (cron) task');
    });

    test('treats a sub loop of a cron task as a sub loop', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'cron', 'c1', true);
        expect(cacheable).toContain('you are a subloop agent');
        expect(cacheable).not.toContain('scheduled (cron) task');
    });
});

describe('personality and emotions', () => {

    test('describes the name, role and personalities of the agent', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', false
        );
        expect(cacheable).toContain('Your name is Ada, your role is engineer.');
        expect(cacheable).toContain('You have the following personalities: calm,curious.');
        expect(cacheable).toContain('You are described as: the agent who ships.');
    });

    test('leaves out the personality list when the agent has none', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity({personalities: []}), 'agent', '', false
        );
        expect(cacheable).toContain('Your name is Ada');
        expect(cacheable).not.toContain('You have the following personalities');
    });

    test('leaves out the description when the agent has none', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity({description: ''}), 'agent', '', false
        );
        expect(cacheable).not.toContain('You are described as');
    });

    test('omits the personality when there is no identity', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', false);
        expect(cacheable).not.toContain('Your name is');
    });

    test('omits the personality for a sub loop', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', true
        );
        expect(cacheable).not.toContain('Your name is');
    });

    test('omits the personality for a cron loop', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'cron', 'c1', false
        );
        expect(cacheable).not.toContain('Your name is');
    });

    test('allows emotions when the identity asks for them', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', false
        );
        expect(cacheable).toContain('You can add your own emotions and feelings about the task');
    });

    test('omits the emotions when the identity switched them off', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity({emotion: false}), 'agent', '', false
        );
        expect(cacheable).not.toContain('You can add your own emotions');
    });

    test('omits the emotions for a sub loop that has an identity', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', true
        );
        expect(cacheable).not.toContain('You can add your own emotions');
    });
});

describe('a sub loop working on a task', () => {

    const TASK = {projectId: 'p1', taskTitle: 'ship it'};

    /** Arranges a task owned by "a2", the agent whose identity the sub loop has to borrow. */
    async function loadServiceWithAssignee() {
        const service = await loadService();
        service.getTask.mockReturnValue({title: 'ship it', assignee: 'a2'} as Task);
        service.getAgent.mockReturnValue(newIdentity({
            id: 'a2', name: 'Bob', role: 'reviewer', personalities: ['picky'],
        }));
        return service;
    }

    test('speaks as the agent the task is assigned to', async () => {
        const {PromptService, getAgent} = await loadServiceWithAssignee();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', true, TASK
        );
        expect(getAgent).toHaveBeenCalledWith('a2');
        expect(cacheable).toContain('Your name is Bob, your role is reviewer.');
        expect(cacheable).not.toContain('Your name is Ada');
    });

    test('stays anonymous when the task has no assignee', async () => {
        const {PromptService, getTask, getAgent} = await loadServiceWithAssignee();
        getTask.mockReturnValue({title: 'ship it'} as Task);
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', true, TASK
        );
        expect(getAgent).not.toHaveBeenCalled();
        expect(cacheable).not.toContain('Your name is');
    });

    test('stays anonymous when the assignee is no longer an agent', async () => {
        const {PromptService, getAgent} = await loadServiceWithAssignee();
        getAgent.mockReturnValue(undefined);
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', true, TASK
        );
        expect(cacheable).not.toContain('Your name is');
    });

    test('keeps the emotions of the assignee out of its report', async () => {
        const {PromptService} = await loadServiceWithAssignee();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', true, TASK
        );
        expect(cacheable).not.toContain('You can add your own emotions');
    });

    test('puts the task next to the project it belongs to', async () => {
        const {PromptService, assignedTaskPrompt} = await loadServiceWithAssignee();
        const {dynamic} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', true, TASK
        );
        expect(assignedTaskPrompt).toHaveBeenCalledWith('p1', 'ship it');
        expect(dynamic.split('\n').filter(line => line.startsWith('# ')))
            .toEqual(['# Current Project', '# Assigned Task']);
        expect(dynamic).toContain('the assigned task');
    });

    test('describes the project the task belongs to, not the one of the session', async () => {
        const {PromptService, currentProject} = await loadServiceWithAssignee();
        PromptService.provideSystemPrompt(newTestAgentConfig(), newIdentity(), 'agent', '', true, TASK);
        expect(currentProject).toHaveBeenCalledWith('p1');
    });

    test('leaves the task section out of a sub loop without a task', async () => {
        const {PromptService} = await loadServiceWithAssignee();
        const {dynamic} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', true
        );
        expect(dynamic).not.toContain('# Assigned Task');
    });
});

describe('agent mode and project management', () => {

    test('lets an agent use every tool', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', false);
        expect(cacheable).toContain('You are running at agent mode. You can use all tools');
    });

    test('restricts a chat agent to answering', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig({mode: 'chat'}), undefined, 'agent', '', false
        );
        expect(cacheable).toContain('You are running at chat mode.');
        expect(cacheable).toContain('cannot operate the computer via user directions');
    });

    test('explains the project tools outside chat mode', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', false);
        expect(cacheable).toContain('the project tools');
    });

    test('hides the project tools in chat mode', async () => {
        const {PromptService, managementTools} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig({mode: 'chat'}), undefined, 'agent', '', false
        );
        expect(cacheable).not.toContain('the project tools');
        expect(managementTools).not.toHaveBeenCalled();
    });

    test('asks the loop that owns a project to delegate its tasks', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'project', 'p1', false);
        expect(cacheable).toContain('the project tools');
        expect(cacheable).toContain('hand the tasks over');
    });

    test('says nothing about delegation without a project to run', async () => {
        const {PromptService, taskDelegation} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', false);
        expect(cacheable).toContain('the project tools');
        expect(taskDelegation).not.toHaveBeenCalled();
    });

    /** A sub loop is the one the work is delegated to, it does not delegate any further. */
    test('says nothing about delegation to a sub loop', async () => {
        const {PromptService, taskDelegation} = await loadService();
        PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'project', 'p1', true);
        expect(taskDelegation).not.toHaveBeenCalled();
    });

    test('says nothing about delegation to a cron loop', async () => {
        const {PromptService, taskDelegation} = await loadService();
        PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'cron', 'c1', false);
        expect(taskDelegation).not.toHaveBeenCalled();
    });

    test('hides the delegation rules in chat mode', async () => {
        const {PromptService, taskDelegation} = await loadService();
        PromptService.provideSystemPrompt(newTestAgentConfig({mode: 'chat'}), undefined, 'project', 'p1', false);
        expect(taskDelegation).not.toHaveBeenCalled();
    });

    test('keeps the chat mode rules for the sub loop of a chat agent', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig({mode: 'chat'}), undefined, 'agent', '', true
        );
        expect(cacheable).toContain('You are running at chat mode.');
    });
});

describe('memory and skills', () => {

    test('asks the memory manager for the indexes of this loop', async () => {
        const {PromptService, memoryPrompt} = await loadService();
        PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'project', 'p1', false);
        expect(memoryPrompt).toHaveBeenCalledExactlyOnceWith('project', 'a1', 'p1');
    });

    test('embeds the memory prompt in the cacheable part', async () => {
        const {PromptService} = await loadService();
        const {cacheable, dynamic} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), undefined, 'agent', '', false
        );
        expect(cacheable).toContain('the memory prompt');
        expect(dynamic).not.toContain('the memory prompt');
    });

    test('asks the skills manager for the skills of this agent', async () => {
        const {PromptService, skillPrompt} = await loadService();
        PromptService.provideSystemPrompt(newTestAgentConfig({id: 'a7'}), undefined, 'agent', '', false);
        expect(skillPrompt).toHaveBeenCalledExactlyOnceWith('a7');
    });
});

describe('dynamic part', () => {

    test('describes the project the loop is working on', async () => {
        const {PromptService, currentProject} = await loadService();
        const {dynamic} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'project', 'p1', false);
        expect(currentProject).toHaveBeenCalledExactlyOnceWith('p1');
        expect(dynamic).toBe('\n# Current Project\nthe current project');
    });

    test('says no project is being worked on when there is none', async () => {
        const {PromptService, currentProject} = await loadService();
        currentProject.mockReturnValue('');
        const {dynamic} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', false);
        expect(dynamic).toContain('No project is currently being worked on this chat session.');
    });

    test('describes the cron task for a cron loop', async () => {
        const {PromptService} = await loadService();
        const {dynamic} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'cron', 'c1', false);
        expect(dynamic).toContain('You are executing the cron task "nightly report" (id: c1).');
        expect(dynamic).toContain('Schedule: 0 9 * * *.');
        expect(dynamic).toContain('Use the update_cron_output tool with id "c1"');
    });

    test('falls back to the cron id when the task cannot be read', async () => {
        const {PromptService, cronTaskDetail} = await loadService();
        cronTaskDetail.mockImplementation(() => {
            throw new Error('cron task not found');
        });
        const {dynamic} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'cron', 'c9', false);
        expect(dynamic).toContain('You are executing a cron task (id: c9).');
    });

    test('keeps the cron task out of the cacheable part', async () => {
        const {PromptService, currentProject} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'cron', 'c1', false);
        expect(cacheable).not.toContain('Current Cron Task');
        expect(currentProject).not.toHaveBeenCalled();
    });

    test('still describes the cron task for a sub loop of a cron task', async () => {
        const {PromptService} = await loadService();
        const {dynamic} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'cron', 'c1', true);
        expect(dynamic).toContain('# Current Cron Task');
    });
});
