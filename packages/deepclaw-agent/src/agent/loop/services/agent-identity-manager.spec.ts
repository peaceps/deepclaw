import {describe, expect, test, vi} from 'vitest';
import {type AgentIdentity, type AgentSoulIdentity} from '@deepclaw/core';
import {newTestAgentConfig} from '../../../test-support/one-loop-context';

const mocks = vi.hoisted(() => ({
    loadConfig: vi.fn<(key?: string) => unknown>(),
    loadAgentConfig: vi.fn<(agentId: string) => unknown>(),
    ensureFileExist: vi.fn<(filePath: string, content: string) => void>(),
    readFile: vi.fn<(filePath: string) => string>(),
    writeFile: vi.fn<(filePath: string, content: string) => string>(),
}));

vi.mock('@deepclaw/config', () => ({
    loadConfig: mocks.loadConfig,
    loadAgentConfig: mocks.loadAgentConfig,
}));
vi.mock('@deepclaw/i18n', () => ({
    i18nInstance: {t: (key: string) => key},
    parseArrayI18n: (key: string) => [key],
}));
vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {
        ensureFileExist: mocks.ensureFileExist,
        readFile: mocks.readFile,
        writeFile: mocks.writeFile,
    },
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    getLoopLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

function newSoul(overrides: Partial<AgentSoulIdentity> = {}): AgentSoulIdentity {
    return {
        id: 'a1',
        avatar: '🐟',
        role: 'engineer',
        personalities: ['calm'],
        emotion: true,
        expertises: ['typescript'],
        ...overrides,
    };
}

type Disk = {[agentId: string]: {soul?: AgentSoulIdentity | string, description?: string}};

/** The identity map lives in module scope, so every test reloads the module with its own disk. */
async function loadManager(disk: Disk = {a1: {soul: newSoul(), description: 'the first agent'}}) {
    vi.resetModules();
    vi.resetAllMocks();
    mocks.loadConfig.mockReturnValue(Object.keys(disk).map(id => ({id})));
    mocks.loadAgentConfig.mockImplementation(
        (agentId: string) => newTestAgentConfig({id: agentId, name: `name of ${agentId}`})
    );
    mocks.readFile.mockImplementation((filePath: string) => {
        const [, agentId, file] = filePath.split('/');
        const entry = disk[agentId ?? ''];
        if (!entry) throw new Error(`File ${filePath} not found.`);
        if (file === 'SOUL.json') {
            if (entry.soul === undefined) throw new Error(`File ${filePath} not found.`);
            return typeof entry.soul === 'string' ? entry.soul : JSON.stringify(entry.soul);
        }
        return entry.description ?? '';
    });
    mocks.writeFile.mockImplementation((filePath: string) => filePath);
    return (await import('./agent-identity-manager')).AgentIdentityManager;
}

/** Pays the transform of the module graph while the file loads, out of reach of a test timeout. */
await loadManager();

describe('getAgents', () => {

    test('builds an identity for every agent in the configuration', async () => {
        const manager = await loadManager({
            a1: {soul: newSoul(), description: 'the first agent'},
            a2: {soul: newSoul({id: 'a2', avatar: '🐙'}), description: 'the second agent'},
        });
        expect(manager.getAgents().map(agent => agent.id)).toEqual(['a1', 'a2']);
    });

    test('merges the soul file, the agent config and the description file', async () => {
        const manager = await loadManager();
        expect(manager.getAgents()[0]).toEqual({
            id: 'a1',
            avatar: '🐟',
            role: 'engineer',
            personalities: ['calm'],
            emotion: true,
            expertises: ['typescript'],
            name: 'name of a1',
            fired: false,
            description: 'the first agent',
        });
    });

    test('marks an agent that was fired in the configuration', async () => {
        const manager = await loadManager();
        mocks.loadAgentConfig.mockReturnValue(newTestAgentConfig({fired: true}));
        expect(manager.getAgents()[0]!.fired).toBe(true);
    });

    test('creates the missing identity files with the translated defaults', async () => {
        const manager = await loadManager();
        manager.getAgents();
        expect(mocks.ensureFileExist).toHaveBeenCalledWith(
            '.agents/a1/AGENT.md', 'agent.identity.default.description'
        );
        const [, soulDefault] = mocks.ensureFileExist.mock.calls[1]!;
        expect(JSON.parse(soulDefault)).toEqual({
            id: 'a1',
            avatar: '🐟',
            role: 'agent.identity.default.role',
            personalities: ['agent.identity.default.personalities'],
            emotion: true,
            expertises: ['agent.identity.default.expertises'],
            archivedDoneProjects: 0,
        });
    });

    test('reads the configuration only once when agents are already loaded', async () => {
        const manager = await loadManager();
        manager.getAgents();
        manager.getAgents();
        expect(mocks.loadConfig).toHaveBeenCalledOnce();
    });

    test('reads the configuration only once even when it lists no agent', async () => {
        const manager = await loadManager({});
        expect(manager.getAgents()).toEqual([]);
        manager.getAgents();
        expect(mocks.loadConfig).toHaveBeenCalledOnce();
    });

    test('reads the configuration again when the first attempt failed', async () => {
        const manager = await loadManager({a1: {description: 'no soul here'}});
        expect(() => manager.getAgents()).toThrow(/Failed to load identity/);
        expect(() => manager.getAgents()).toThrow(/Failed to load identity/);
        expect(mocks.loadConfig).toHaveBeenCalledTimes(2);
    });

    test('fails when the soul file of an agent cannot be read', async () => {
        const manager = await loadManager({a1: {description: 'no soul here'}});
        expect(() => manager.getAgents())
            .toThrow('Failed to load identity for agent "a1": File .agents/a1/SOUL.json not found.');
    });

    test('fails when the soul file is not valid json', async () => {
        const manager = await loadManager({a1: {soul: '{oops', description: 'broken'}});
        expect(() => manager.getAgents()).toThrow(/Failed to load identity for agent "a1"/);
    });
});

describe('getAgent', () => {

    test('finds an agent by id', async () => {
        const manager = await loadManager();
        expect(manager.getAgent('a1')?.name).toBe('name of a1');
    });

    test('answers with nothing for an unknown id', async () => {
        const manager = await loadManager();
        expect(manager.getAgent('ghost')).toBeUndefined();
    });
});

describe('newAgentIdentity', () => {

    test('creates the files and registers the new agent', async () => {
        const manager = await loadManager({a9: {soul: newSoul({id: 'a9'}), description: 'a brand new agent'}});
        mocks.loadConfig.mockReturnValue([]);
        const identity = manager.newAgentIdentity('a9');
        expect(identity.description).toBe('a brand new agent');
        expect(mocks.ensureFileExist).toHaveBeenCalledWith(
            '.agents/a9/AGENT.md', 'agent.identity.default.description'
        );
        expect(manager.getAgent('a9')).toBe(identity);
    });

    test('does not read the agents configuration', async () => {
        const manager = await loadManager({a9: {soul: newSoul({id: 'a9'}), description: 'new'}});
        manager.newAgentIdentity('a9');
        expect(mocks.loadConfig).not.toHaveBeenCalled();
    });

    test('still lists the configured agents afterwards', async () => {
        const manager = await loadManager({
            a1: {soul: newSoul(), description: 'the first agent'},
            a9: {soul: newSoul({id: 'a9'}), description: 'a brand new agent'},
        });
        manager.newAgentIdentity('a9');
        expect(manager.getAgents().map(agent => agent.id)).toEqual(['a9', 'a1']);
    });
});

describe('updateAgentIdentity', () => {

    async function loadWithAgent(soul: AgentSoulIdentity = newSoul()) {
        const manager = await loadManager({a1: {soul, description: 'the first agent'}});
        manager.getAgents();
        mocks.writeFile.mockClear();
        return manager;
    }

    test('fails for an agent that is not registered', async () => {
        const manager = await loadWithAgent();
        expect(() => manager.updateAgentIdentity({id: 'ghost', role: 'boss'}))
            .toThrow('Agent "ghost" not found');
    });

    test('writes a new description to the markdown file', async () => {
        const manager = await loadWithAgent();
        manager.updateAgentIdentity({id: 'a1', description: 'a rewritten description'});
        expect(mocks.writeFile)
            .toHaveBeenCalledExactlyOnceWith('.agents/a1/AGENT.md', 'a rewritten description');
        expect(manager.getAgent('a1')?.description).toBe('a rewritten description');
    });

    test('turns a cleared description into an empty file', async () => {
        const manager = await loadWithAgent();
        manager.updateAgentIdentity({id: 'a1', description: null});
        expect(mocks.writeFile).toHaveBeenCalledExactlyOnceWith('.agents/a1/AGENT.md', '');
        expect(manager.getAgent('a1')?.description).toBe('');
    });

    test('leaves the description untouched when it is not part of the patch', async () => {
        const manager = await loadWithAgent();
        manager.updateAgentIdentity({id: 'a1', role: 'architect'});
        expect(manager.getAgent('a1')?.description).toBe('the first agent');
    });

    test('persists the soul file when a soul field changes', async () => {
        const manager = await loadWithAgent();
        manager.updateAgentIdentity({id: 'a1', role: 'architect', personalities: ['bold']});
        expect(mocks.writeFile).toHaveBeenCalledExactlyOnceWith(
            '.agents/a1/SOUL.json',
            JSON.stringify({
                id: 'a1',
                avatar: '🐟',
                role: 'architect',
                personalities: ['bold'],
                emotion: true,
                expertises: ['typescript'],
                archivedDoneProjects: 0,
            }, null, 2)
        );
    });

    /**
     * The soul file is written whole, so a count left out of that write would be a count the next
     * change of avatar wipes: the projects it stands for are gone from the disk and this is the only
     * record that they were ever worked.
     */
    test('keeps the projects already counted when another soul field changes', async () => {
        const manager = await loadWithAgent(newSoul({archivedDoneProjects: 7}));
        manager.updateAgentIdentity({id: 'a1', avatar: '🐙'});
        expect(JSON.parse(mocks.writeFile.mock.calls[0]![1]).archivedDoneProjects).toBe(7);
    });

    test('writes a count that the patch itself carries', async () => {
        const manager = await loadWithAgent(newSoul({archivedDoneProjects: 2}));
        manager.updateAgentIdentity({id: 'a1', archivedDoneProjects: 3});
        expect(manager.getAgent('a1')?.archivedDoneProjects).toBe(3);
        expect(JSON.parse(mocks.writeFile.mock.calls[0]![1]).archivedDoneProjects).toBe(3);
    });

    test('persists the soul file when emotions are switched off', async () => {
        const manager = await loadWithAgent();
        manager.updateAgentIdentity({id: 'a1', emotion: false});
        expect(manager.getAgent('a1')?.emotion).toBe(false);
        expect(mocks.writeFile).toHaveBeenCalledOnce();
    });

    test('keeps the soul file untouched when only the name changes', async () => {
        const manager = await loadWithAgent();
        manager.updateAgentIdentity({id: 'a1', name: 'renamed'});
        expect(manager.getAgent('a1')?.name).toBe('renamed');
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    test('applies the description and the soul in one patch', async () => {
        const manager = await loadWithAgent();
        manager.updateAgentIdentity({id: 'a1', description: 'both at once', avatar: '🐙'});
        expect(mocks.writeFile).toHaveBeenCalledTimes(2);
        expect(mocks.writeFile.mock.calls.map(call => call[0]))
            .toEqual(['.agents/a1/AGENT.md', '.agents/a1/SOUL.json']);
    });

    test('copies a null soul field straight into the identity', async () => {
        const manager = await loadWithAgent();
        manager.updateAgentIdentity({id: 'a1', avatar: null});
        expect(manager.getAgent('a1')?.avatar).toBeNull();
    });

    test('does not change the id of the agent', async () => {
        const manager = await loadWithAgent();
        manager.updateAgentIdentity({id: 'a1', role: 'architect'});
        const identity: AgentIdentity | undefined = manager.getAgent('a1');
        expect(identity?.id).toBe('a1');
    });
});
