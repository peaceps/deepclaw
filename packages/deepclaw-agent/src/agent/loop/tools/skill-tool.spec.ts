import {beforeEach, describe, expect, test, vi} from 'vitest';
import {newTestAgentConfig, newTestContext} from '../../../test-support/one-loop-context';
import {SkillsManager} from '../services/skills-manager';
import {
    createSkillTool,
    downloadSkillTool,
    loadSkillDetailsTool,
    refreshSkillsTool,
    removeSkillTool,
    searchOnlineSkillsTool,
} from './skill-tool';

const mocks = vi.hoisted(() => ({
    runCommand: vi.fn<(command: string) => Promise<{output: string}>>(),
    loadLang: vi.fn<() => string>(() => 'en'),
}));

vi.mock('@deepclaw/config', () => ({loadLang: mocks.loadLang}));
vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {readDir: vi.fn(() => ({})), readFile: vi.fn(), writeFile: vi.fn(), exists: vi.fn(() => false)},
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    runCommand: mocks.runCommand,
}));

const getSkillContent = vi.spyOn(SkillsManager, 'getSkillContent');
const reloadSkills = vi.spyOn(SkillsManager, 'reloadSkills');
const getAvailableSkillsPrompt = vi.spyOn(SkillsManager, 'getAvailableSkillsPrompt');
const createSkill = vi.spyOn(SkillsManager, 'createSkill');
const removeSkill = vi.spyOn(SkillsManager, 'removeSkill');

/** A run of the mode that has no tool to run a command, which some of these tools are offered in. */
const chatContext = () => newTestContext({loopConfig: newTestAgentConfig({mode: 'chat'})});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadLang.mockReturnValue('en');
    mocks.runCommand.mockResolvedValue({output: 'command output'});
    reloadSkills.mockReturnValue(undefined);
    getAvailableSkillsPrompt.mockReturnValue('- demo: a demo skill\n');
});

describe('loadSkillDetailsTool invoke', () => {

    test('returns the body the manager holds for the skill', async () => {
        getSkillContent.mockReturnValue('<skill name="demo">body</skill>');
        const result = await loadSkillDetailsTool.invoke({name: 'demo'}, newTestContext());
        expect(getSkillContent).toHaveBeenCalledExactlyOnceWith('demo', 'agent');
        expect(result).toBe('<skill name="demo">body</skill>');
    });

    /** Reading a skill is held to the modes it is offered in, so the manager is told which asks. */
    test('asks for the body under the mode of the run', async () => {
        getSkillContent.mockReturnValue('<skill name="demo">body</skill>');
        await loadSkillDetailsTool.invoke({name: 'demo'}, chatContext());
        expect(getSkillContent).toHaveBeenCalledExactlyOnceWith('demo', 'chat');
    });
});

describe('refreshSkillsTool invoke', () => {

    test('reloads from disk and lists what the agent can use', async () => {
        const result = await refreshSkillsTool.invoke(undefined, newTestContext());
        expect(reloadSkills).toHaveBeenCalledOnce();
        expect(getAvailableSkillsPrompt).toHaveBeenCalledExactlyOnceWith('a1', 'agent');
        expect(result).toBe('Skills refreshed.\nAvailable skills:\n- demo: a demo skill\n');
    });

    /** The prompt of the run listed the skills of the borrowed agent, this list has to match it. */
    test('lists the skills of the agent the run stands for', async () => {
        await refreshSkillsTool.invoke(undefined, newTestContext({loopKind: 'task', personaId: 'a2'}));
        expect(getAvailableSkillsPrompt).toHaveBeenCalledExactlyOnceWith('a2', 'agent');
    });

    /** This tool is offered in chat mode too, and the prompt of a chat run lists fewer skills. */
    test('lists what the mode of the run can use, not what agent mode could', async () => {
        await refreshSkillsTool.invoke(undefined, chatContext());
        expect(getAvailableSkillsPrompt).toHaveBeenCalledExactlyOnceWith('a1', 'chat');
    });
});

describe('searchOnlineSkillsTool invoke', () => {

    test('searches the registry with all keywords joined', async () => {
        const result = await searchOnlineSkillsTool.invoke({keywords: ['pdf', 'excel']}, newTestContext());
        expect(mocks.runCommand).toHaveBeenCalledExactlyOnceWith('npx -y skills find pdf excel');
        expect(result).toBe('command output');
    });

    test('uses the chinese package when the ui runs in chinese', async () => {
        mocks.loadLang.mockReturnValue('zh');
        await searchOnlineSkillsTool.invoke({keywords: ['pdf']}, newTestContext());
        expect(mocks.runCommand).toHaveBeenCalledExactlyOnceWith('npx -y skills-cn find pdf');
    });

    test('reports a failed search instead of throwing', async () => {
        mocks.runCommand.mockRejectedValue(new Error('offline'));
        const result = await searchOnlineSkillsTool.invoke({keywords: ['pdf']}, newTestContext());
        expect(result).toBe('Search failed: Error: offline');
    });
});

describe('searchOnlineSkillsTool guard', () => {

    test('allows plain keywords', () => {
        expect(searchOnlineSkillsTool.guard!({keywords: ['pdf', 'excel']}, newTestContext()))
            .toEqual({result: 'allowed'});
    });

    test('denies keywords that could smuggle in a shell command', () => {
        const result = searchOnlineSkillsTool.guard!({keywords: ['pdf; rm -rf /']}, newTestContext());
        expect(result).toEqual({result: 'denied', reason: 'Invalid input format. Expected /^[\\w\\s-]+$/'});
    });
});

describe('downloadSkillTool invoke', () => {

    /** The -a pins the install to .agents/skills, the only folder the manager reads. */
    test('installs the skill and reloads the local skills', async () => {
        const result = await downloadSkillTool.invoke({target: 'vercel-labs/agent-skills@react'}, newTestContext());
        expect(mocks.runCommand).toHaveBeenCalledExactlyOnceWith('npx -y skills add vercel-labs/agent-skills@react -a universal -y');
        expect(reloadSkills).toHaveBeenCalledOnce();
        expect(result).toBe('command output');
    });

    test('retries with the mirror package when the first install fails', async () => {
        mocks.runCommand.mockRejectedValueOnce(new Error('registry down'))
            .mockResolvedValueOnce({output: 'installed from mirror'});
        const result = await downloadSkillTool.invoke({target: 'org/repo@skill'}, newTestContext());
        expect(mocks.runCommand.mock.calls[1]![0]).toBe('npx -y skills-cn add org/repo@skill -a universal -y');
        expect(result).toBe('installed from mirror');
        expect(reloadSkills).toHaveBeenCalledOnce();
    });

    test('gives up and skips the reload when both registries fail', async () => {
        mocks.runCommand.mockRejectedValue(new Error('registry down'));
        const result = await downloadSkillTool.invoke({target: 'org/repo@skill'}, newTestContext());
        expect(result).toBe('skills add failed: Error: registry down');
        expect(reloadSkills).not.toHaveBeenCalled();
    });

    test('denies a target that does not look like a skill path', () => {
        expect(downloadSkillTool.guard!({target: 'org/repo@skill && whoami'}, newTestContext()).result)
            .toBe('denied');
        expect(downloadSkillTool.guard!({target: 'org/repo@skill'}, newTestContext()))
            .toEqual({result: 'allowed'});
    });
});

describe('removeSkillTool', () => {

    /** Removal is a folder delete the manager owns; no cli run hides behind it. */
    test('deletes the folder through the manager and lists what remains', async () => {
        removeSkill.mockReturnValue(true);
        const result = await removeSkillTool.invoke({name: 'react-best-practices'}, newTestContext());
        expect(removeSkill).toHaveBeenCalledExactlyOnceWith('react-best-practices');
        expect(mocks.runCommand).not.toHaveBeenCalled();
        expect(result).toBe('Skill react-best-practices removed.\nAvailable skills:\n- demo: a demo skill\n');
    });

    test('tells what is installed when no such skill exists', async () => {
        removeSkill.mockReturnValue(false);
        const result = await removeSkillTool.invoke({name: 'ghost'}, newTestContext());
        expect(result).toBe('No skill named "ghost" is installed, nothing removed.\n'
            + 'Available skills:\n- demo: a demo skill\n');
    });

    test('denies a name that walks out of the skills folder', () => {
        expect(removeSkillTool.guard!({name: '../../etc'}, newTestContext()).result).toBe('denied');
        expect(removeSkillTool.guard!({name: 'react-best-practices'}, newTestContext()))
            .toEqual({result: 'allowed'});
    });

    /** The prompt lists skills by name, and a name is written as its author wrote it. */
    test('allows a name written as the skills list shows it', () => {
        expect(removeSkillTool.guard!({name: 'Convex Best Practices'}, newTestContext()))
            .toEqual({result: 'allowed'});
        expect(removeSkillTool.guard!({name: 'next.js-best-practices'}, newTestContext()))
            .toEqual({result: 'allowed'});
    });
});

describe('createSkillTool invoke', () => {

    test('writes the skill files and lists the skills afterwards', async () => {
        createSkill.mockReturnValue(undefined);
        const files = [{path: 'SKILL.md', content: '---\nname: demo\n---\nbody'}];
        const result = await createSkillTool.invoke({name: 'demo', files}, newTestContext());
        expect(createSkill).toHaveBeenCalledExactlyOnceWith('demo', files);
        expect(result).toBe('Skill demo created.\nAvailable skills:\n- demo: a demo skill\n');
    });

    test('reports why the skill could not be created', async () => {
        createSkill.mockImplementation(() => {
            throw new Error('Skill already exists.');
        });
        const result = await createSkillTool.invoke({name: 'demo', files: []}, newTestContext());
        expect(result).toBe('Failed to create skill demo: Skill already exists.');
        expect(getAvailableSkillsPrompt).not.toHaveBeenCalled();
    });
});

describe('skill tool metadata', () => {

    test('only the mutating skill tools are limited to agent mode', () => {
        expect(loadSkillDetailsTool.agentMode).toEqual(['agent', 'chat']);
        expect(refreshSkillsTool.agentMode).toEqual(['agent', 'chat']);
        expect(downloadSkillTool.agentMode).toEqual(['agent']);
        expect(removeSkillTool.parallelSafe).toBe(false);
        expect(createSkillTool.parallelSafe).toBe(false);
        expect(downloadSkillTool.parallelSafe).toBe(false);
        expect(loadSkillDetailsTool.parallelSafe).toBe(true);
    });
});
