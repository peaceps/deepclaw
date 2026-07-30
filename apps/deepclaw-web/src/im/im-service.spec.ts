import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentConfig} from '@deepclaw/config';

const mocks = vi.hoisted(() => ({
    loadConfig: vi.fn<(key: string) => AgentConfig[]>(),
    connectIM: vi.fn<(agentId: string) => {disconnect: () => void}>(),
    cleanupOnShutdown: vi.fn<(cleanup: () => void) => void>(),
    disconnect: vi.fn<() => void>(),
}));

vi.mock('@deepclaw/config', () => ({loadConfig: mocks.loadConfig}));

vi.mock('@deepclaw/im', () => ({connectIM: mocks.connectIM}));

vi.mock('@deepclaw/node-utils', () => ({cleanupOnShutdown: mocks.cleanupOnShutdown}));

type IMServiceType = (typeof import('./im-service'))['IMService'];

function newAgent(id: string, enabled: boolean): AgentConfig {
    return {
        id,
        name: id,
        mode: 'agent',
        im: {enabled},
        llm: {baseURL: 'https://api.example.com', apiKey: 'key', model: 'model'},
    };
}

function configured(agents: AgentConfig[]): void {
    mocks.loadConfig.mockReturnValue(agents);
}

/** The service is a globalized singleton, so the global slot is dropped to give every test its own store. */
async function loadService(): Promise<IMServiceType> {
    delete (globalThis as unknown as Record<string, unknown>)['__IMService'];
    vi.resetModules();
    return (await import('./im-service')).IMService;
}

/** Pays the transform of the module graph while the file loads, out of reach of the hook timeout. */
configured([]);
await loadService();

let service: IMServiceType;

beforeEach(async () => {
    vi.clearAllMocks();
    mocks.connectIM.mockImplementation(() => ({disconnect: mocks.disconnect}));
    configured([]);
    service = await loadService();
});

describe('reset', () => {

    test('connects an agent whose im is enabled', () => {
        configured([newAgent('a1', true)]);
        service.reset();
        expect(mocks.connectIM).toHaveBeenCalledWith('a1');
    });

    test('reads the agents from the config every time', () => {
        configured([newAgent('a1', true)]);
        service.reset();
        expect(mocks.loadConfig).toHaveBeenCalledWith('agents');
    });

    test('leaves an agent whose im is disabled alone', () => {
        configured([newAgent('a1', false)]);
        service.reset();
        expect(mocks.connectIM).not.toHaveBeenCalled();
        expect(mocks.disconnect).not.toHaveBeenCalled();
    });

    test('keeps an already connected agent on its connection', () => {
        configured([newAgent('a1', true)]);
        service.reset();
        service.reset();
        expect(mocks.connectIM).toHaveBeenCalledOnce();
        expect(mocks.disconnect).not.toHaveBeenCalled();
    });

    test('disconnects an agent whose im was switched off', () => {
        configured([newAgent('a1', true)]);
        service.reset();
        configured([newAgent('a1', false)]);
        service.reset();
        expect(mocks.disconnect).toHaveBeenCalledOnce();
    });

    test('connects the agent again after it was switched off and on', () => {
        configured([newAgent('a1', true)]);
        service.reset();
        configured([newAgent('a1', false)]);
        service.reset();
        configured([newAgent('a1', true)]);
        service.reset();
        expect(mocks.connectIM).toHaveBeenCalledTimes(2);
    });

    test('connects every enabled agent of the config', () => {
        configured([newAgent('a1', true), newAgent('a2', false), newAgent('a3', true)]);
        service.reset();
        expect(mocks.connectIM.mock.calls.map(call => call[0])).toEqual(['a1', 'a3']);
    });

    test('does nothing for a config without agents', () => {
        service.reset();
        expect(mocks.connectIM).not.toHaveBeenCalled();
    });
});

describe('init', () => {

    test('connects the enabled agents right away', () => {
        configured([newAgent('a1', true)]);
        service.init();
        expect(mocks.connectIM).toHaveBeenCalledWith('a1');
    });

    test('registers a shutdown hook once', () => {
        service.init();
        expect(mocks.cleanupOnShutdown).toHaveBeenCalledOnce();
    });

    test('disconnects every running im on shutdown', () => {
        configured([newAgent('a1', true), newAgent('a2', true)]);
        service.init();
        mocks.cleanupOnShutdown.mock.calls[0]![0]();
        expect(mocks.disconnect).toHaveBeenCalledTimes(2);
    });

    test('has nothing to disconnect on shutdown when no im runs', () => {
        service.init();
        mocks.cleanupOnShutdown.mock.calls[0]![0]();
        expect(mocks.disconnect).not.toHaveBeenCalled();
    });
});

describe('connect', () => {

    test('remembers the disconnect callback of the connection', () => {
        service.connect('a1');
        service.disconnect('a1');
        expect(mocks.disconnect).toHaveBeenCalledOnce();
    });

    test('replaces the connection of an agent that was connected twice', () => {
        const second = vi.fn<() => void>();
        service.connect('a1');
        mocks.connectIM.mockReturnValue({disconnect: second});
        service.connect('a1');
        service.disconnect('a1');
        expect(second).toHaveBeenCalledOnce();
        expect(mocks.disconnect).not.toHaveBeenCalled();
    });
});

describe('disconnect', () => {

    test('forgets the connection so it is not closed twice', () => {
        service.connect('a1');
        service.disconnect('a1');
        service.disconnect('a1');
        expect(mocks.disconnect).toHaveBeenCalledOnce();
    });

    test('ignores an agent that never connected', () => {
        expect(() => service.disconnect('ghost')).not.toThrow();
        expect(mocks.disconnect).not.toHaveBeenCalled();
    });
});
