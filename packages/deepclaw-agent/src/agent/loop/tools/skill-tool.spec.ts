import {beforeEach, describe, expect, test, vi} from 'vitest';
import {newTestContext} from '../../../test-support/one-loop-context';
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
    runCommand: vi.fn<(command: string) => Promise<{output: string, preview: string}>>(),
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

beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadLang.mockReturnValue('en');
    mocks.runCommand.mockResolvedValue({output: 'command output', preview: 'command output'});
    reloadSkills.mockReturnValue(undefined);
    getAvailableSkillsPrompt.mockReturnValue('- demo: a demo skill\n');
});

describe('loadSkillDetailsTool invoke', () => {

    test('returns the body the manager holds for the skill', async () => {
        getSkillContent.mockReturnValue('<skill name="demo">body</skill>');
        const result = await loadSkillDetailsTool.invoke({name: 'demo'}, newTestContext());
        expect(getSkillContent).toHaveBeenCalledExactlyOnceWith('demo');
        expect(result).toBe('<skill name="demo">body</skill>');
    });
});

describe('refreshSkillsTool invoke', () => {

    test('reloads from disk and lists what the agent can use', async () => {
        const result = await refreshSkillsTool.invoke(undefined, newTestContext());
        expect(reloadSkills).toHaveBeenCalledOnce();
        expect(getAvailableSkillsPrompt).toHaveBeenCalledExactlyOnceWith('a1');
        expect(result).toBe('Skills refreshed.\nAvailable skills:\n- demo: a demo skill\n');
    });
});

describe('searchOnlineSkillsTool invoke', () => {

    test('searches the registry with all keywords joined', async () => {
        const result = await searchOnlineSkillsTool.invoke({keywords: ['pdf', 'excel']}, newTestContext());
        expect(mocks.runCommand).toHaveBeenCalledExactlyOnceWith('npx skills find pdf excel');
        expect(result).toBe('command output');
    });

    test('uses the chinese package when the ui runs in chinese', async () => {
        mocks.loadLang.mockReturnValue('zh');
        await searchOnlineSkillsTool.invoke({keywords: ['pdf']}, newTestContext());
        expect(mocks.runCommand).toHaveBeenCalledExactlyOnceWith('npx skills-cn find pdf');
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

    test('installs the skill and reloads the local skills', async () => {
        const result = await downloadSkillTool.invoke({target: 'vercel-labs/agent-skills@react'}, newTestContext());
        expect(mocks.runCommand).toHaveBeenCalledExactlyOnceWith('npx skills add vercel-labs/agent-skills@react -y');
        expect(reloadSkills).toHaveBeenCalledOnce();
        expect(result).toBe('command output');
    });

    test('retries with the mirror package when the first install fails', async () => {
        mocks.runCommand.mockRejectedValueOnce(new Error('registry down'))
            .mockResolvedValueOnce({output: 'installed from mirror', preview: ''});
        const result = await downloadSkillTool.invoke({target: 'org/repo@skill'}, newTestContext());
        expect(mocks.runCommand.mock.calls[1]![0]).toBe('npx skills-cn add org/repo@skill -y');
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

    test('removes the skill by its directory name and reloads', async () => {
        const result = await removeSkillTool.invoke({dirName: 'react-best-practices'}, newTestContext());
        expect(mocks.runCommand).toHaveBeenCalledExactlyOnceWith('npx skills remove react-best-practices -y');
        expect(reloadSkills).toHaveBeenCalledOnce();
        expect(result).toBe('command output');
    });

    test('denies a directory name that walks out of the skills folder', () => {
        expect(removeSkillTool.guard!({dirName: '../../etc'}, newTestContext()).result).toBe('denied');
        expect(removeSkillTool.guard!({dirName: 'react-best-practices'}, newTestContext()))
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
    });
});
