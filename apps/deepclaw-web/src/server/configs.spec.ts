import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentConfig, type DeepclawConfig, type MissingAppConfig} from '@deepclaw/config';
import {loadCurrentConfig, saveFullConfig, updateManagerAvatar, validateConfig} from './configs';

const mocks = vi.hoisted(() => ({
    loadConfig: vi.fn<(key?: string, defaultValue?: unknown) => unknown>(),
    writeAppConfig: vi.fn<(config: DeepclawConfig) => void>(),
    validateAppConfig: vi.fn<(config: Partial<DeepclawConfig>) => {lacks: MissingAppConfig}>(),
    updateAgentIdentity: vi.fn<(identity: {id: string; name: string; fired: boolean}) => void>(),
    newAgentIdentity: vi.fn<(id: string) => void>(),
    updateGatewayConfig: vi.fn<(config: DeepclawConfig) => void>(),
    resetIM: vi.fn<() => void>(),
    revalidatePath: vi.fn<(path: string, type: string) => void>(),
}));

vi.mock('@deepclaw/config', () => ({
    loadConfig: mocks.loadConfig,
    writeAppConfig: mocks.writeAppConfig,
    validateAppConfig: mocks.validateAppConfig,
}));

vi.mock('@deepclaw/loop-gateway', () => ({
    LoopGateway: {
        updateAgentIdentity: mocks.updateAgentIdentity,
        newAgentIdentity: mocks.newAgentIdentity,
        updateConfig: mocks.updateGatewayConfig,
    },
}));

vi.mock('next/cache', () => ({revalidatePath: mocks.revalidatePath}));

vi.mock('@/im/im-service', () => ({IMService: {reset: mocks.resetIM}}));

function newAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
    return {
        id: 'a1',
        name: 'Ada',
        mode: 'agent',
        im: {enabled: false},
        llm: {baseURL: 'https://api.example.com', apiKey: 'key', model: 'model'},
        ...overrides,
    };
}

function newConfig(agents: AgentConfig[] = [newAgent()]): DeepclawConfig {
    return {
        manager: {name: 'Deepclaw', title: 'CEO', avatar: '🐋'},
        agents,
        ui: {lang: 'en'},
        advanced: {},
    };
}

function onDisk(agents: AgentConfig[], avatar?: string): void {
    mocks.loadConfig.mockImplementation(key => {
        if (key === 'agents') {
            return agents;
        }
        if (key === 'manager.avatar') {
            return avatar;
        }
        return newConfig(agents);
    });
}

function writtenConfig(): DeepclawConfig {
    return mocks.writeAppConfig.mock.calls.at(-1)![0];
}

function lacking(lacks: MissingAppConfig): void {
    mocks.validateAppConfig.mockReturnValue({lacks});
}

beforeEach(() => {
    vi.clearAllMocks();
    onDisk([newAgent()], '🐋');
    lacking([]);
});

describe('loadCurrentConfig', () => {

    test('reads the whole config when no key is given', async () => {
        await expect(loadCurrentConfig()).resolves.toEqual(newConfig());
        expect(mocks.loadConfig).toHaveBeenCalledWith(undefined, undefined);
    });

    test('passes the key and the default value on', async () => {
        mocks.loadConfig.mockReturnValue('zh');
        await expect(loadCurrentConfig('ui.lang', 'en')).resolves.toBe('zh');
        expect(mocks.loadConfig).toHaveBeenCalledWith('ui.lang', 'en');
    });
});

describe('saveFullConfig', () => {

    test('keeps the avatar that is already stored', async () => {
        onDisk([newAgent()], '🦊');
        await saveFullConfig(newConfig());
        expect(writtenConfig().manager).toEqual({name: 'Deepclaw', title: 'CEO', avatar: '🦊'});
    });

    /** The stored avatar always wins, so an incoming avatar is lost while none is stored yet. */
    test('leaves the manager without an avatar when none is stored yet', async () => {
        onDisk([newAgent()]);
        await saveFullConfig(newConfig());
        expect(writtenConfig().manager.avatar).toBeUndefined();
    });

    test('updates the identity of an agent that was already known', async () => {
        onDisk([newAgent({id: 'a1'})]);
        await saveFullConfig(newConfig([newAgent({id: 'a1', name: 'Ada II'})]));
        expect(mocks.updateAgentIdentity).toHaveBeenCalledWith({id: 'a1', name: 'Ada II', fired: false});
        expect(mocks.newAgentIdentity).not.toHaveBeenCalled();
    });

    test('hires an agent the stored config never saw', async () => {
        onDisk([newAgent({id: 'a1'})]);
        await saveFullConfig(newConfig([newAgent({id: 'a1'}), newAgent({id: 'a2', name: 'Bob'})]));
        expect(mocks.newAgentIdentity).toHaveBeenCalledWith('a2');
        expect(mocks.updateAgentIdentity).toHaveBeenCalledOnce();
    });

    test('passes the fired flag on as a boolean', async () => {
        onDisk([newAgent({id: 'a1'})]);
        await saveFullConfig(newConfig([newAgent({id: 'a1', fired: true})]));
        expect(mocks.updateAgentIdentity).toHaveBeenCalledWith({id: 'a1', name: 'Ada', fired: true});
    });

    test('restarts the im connections and pushes the merged config into the loops', async () => {
        onDisk([newAgent()], '🦊');
        await saveFullConfig(newConfig());
        expect(mocks.resetIM).toHaveBeenCalledOnce();
        expect(mocks.updateGatewayConfig).toHaveBeenCalledWith(writtenConfig());
    });

    test('revalidates the whole layout', async () => {
        await saveFullConfig(newConfig());
        expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
    });

    test('writes the config before touching the agents', async () => {
        await saveFullConfig(newConfig());
        expect(mocks.writeAppConfig.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.updateAgentIdentity.mock.invocationCallOrder[0]!);
    });

    test('accepts a config without any agent', async () => {
        await saveFullConfig(newConfig([]));
        expect(mocks.updateAgentIdentity).not.toHaveBeenCalled();
        expect(mocks.newAgentIdentity).not.toHaveBeenCalled();
        expect(mocks.updateGatewayConfig).toHaveBeenCalledOnce();
    });
});

describe('updateManagerAvatar', () => {

    test('stores the new avatar next to the rest of the config', async () => {
        await updateManagerAvatar('🦊');
        expect(writtenConfig().manager).toEqual({name: 'Deepclaw', title: 'CEO', avatar: '🦊'});
        expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
    });

    test('rejects an empty avatar', async () => {
        await expect(updateManagerAvatar('')).rejects.toThrow('Invalid avatar');
        expect(mocks.writeAppConfig).not.toHaveBeenCalled();
    });

    test('rejects an avatar longer than sixteen characters', async () => {
        await expect(updateManagerAvatar('x'.repeat(17))).rejects.toThrow('Invalid avatar');
        expect(mocks.writeAppConfig).not.toHaveBeenCalled();
    });

    test('accepts an avatar of exactly sixteen characters', async () => {
        await updateManagerAvatar('x'.repeat(16));
        expect(writtenConfig().manager.avatar).toBe('x'.repeat(16));
    });

    test('leaves the loops and the im connections alone', async () => {
        await updateManagerAvatar('🦊');
        expect(mocks.updateGatewayConfig).not.toHaveBeenCalled();
        expect(mocks.resetIM).not.toHaveBeenCalled();
    });
});

describe('validateConfig', () => {

    test('reports a complete config without errors and with every panel closed', async () => {
        const result = await validateConfig(newConfig());
        expect(result.errors).toEqual([]);
        expect(result.summary).toEqual({uiErrorCount: 0, agentErrorCount: 0, affectedAgents: 0, agentIndices: []});
        expect(result.panelState).toEqual({});
    });

    test('validates the config it was given', async () => {
        const config = newConfig();
        await validateConfig(config);
        expect(mocks.validateAppConfig).toHaveBeenCalledWith(config);
    });

    test('opens the ui panel for a missing language', async () => {
        lacking(['ui.lang']);
        const result = await validateConfig({});
        expect(result.errors).toEqual(['ui.lang']);
        expect(result.summary.uiErrorCount).toBe(1);
        expect(result.panelState).toEqual({ui: true});
    });

    test('flattens a missing agent field into an indexed key', async () => {
        lacking([{agents: {0: ['name', 'llm.apiKey']}}]);
        const result = await validateConfig({});
        expect(result.errors).toEqual(['agents.0.name', 'agents.0.llm.apiKey']);
        expect(result.summary).toEqual({
            uiErrorCount: 0, agentErrorCount: 2, affectedAgents: 1, agentIndices: [0],
        });
    });

    test('opens the agents panel and the panel of every failing agent', async () => {
        lacking([{agents: {0: ['name'], 2: ['llm.model']}}]);
        const result = await validateConfig({});
        expect(result.summary.agentIndices).toEqual([0, 2]);
        expect(result.panelState).toEqual({agents: true, 'agents.0': true, 'agents.2': true});
    });

    test('counts several errors of the same agent as one affected agent', async () => {
        lacking([{agents: {1: ['name', 'mode', 'llm.model']}}]);
        const result = await validateConfig({});
        expect(result.summary.agentErrorCount).toBe(3);
        expect(result.summary.affectedAgents).toBe(1);
    });

    test('reports the ui and the agent errors side by side', async () => {
        lacking(['ui.lang', {agents: {0: ['name']}}]);
        const result = await validateConfig({});
        expect(result.errors).toEqual(['ui.lang', 'agents.0.name']);
        expect(result.panelState).toEqual({ui: true, agents: true, 'agents.0': true});
    });

    /** A config without any agents section reports the bare key, which no panel prefix matches. */
    test('counts a missing agents section nowhere and opens no panel for it', async () => {
        lacking(['agents']);
        const result = await validateConfig({});
        expect(result.errors).toEqual(['agents']);
        expect(result.summary).toEqual({uiErrorCount: 0, agentErrorCount: 0, affectedAgents: 0, agentIndices: []});
        expect(result.panelState).toEqual({});
    });
});
