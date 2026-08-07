import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentConfig} from '@deepclaw/config';
import type {SSEToastEvent} from '@/app/api/sse-types';

type Connection = {disconnect: () => void};

const mocks = vi.hoisted(() => ({
    loadConfig: vi.fn<(key: string) => AgentConfig[]>(),
    connectIM: vi.fn<(agentId: string) => Promise<Connection>>(),
    cleanupOnShutdown: vi.fn<(cleanup: () => void) => void>(),
    disconnect: vi.fn<() => void>(),
    sendToast: vi.fn<(content: SSEToastEvent['content'], browserId?: string) => void>(),
    error: vi.fn<(message: string) => void>(),
}));

vi.mock('@deepclaw/config', () => ({loadConfig: mocks.loadConfig}));

vi.mock('@deepclaw/im', () => ({connectIM: mocks.connectIM}));

vi.mock('@deepclaw/node-utils', () => ({
    cleanupOnShutdown: mocks.cleanupOnShutdown,
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.error}),
}));

/** Stands in for the real server, which would pull the whole gateway into the run. */
vi.mock('@/app/api/sse-server', () => ({SSEServer: {sendToast: mocks.sendToast}}));

type IMServiceType = (typeof import('./im-service'))['IMService'];

function newAgent(id: string, enabled: boolean, name: string = id): AgentConfig {
    return {
        id,
        name,
        mode: 'agent',
        im: {enabled},
        llm: {baseURL: 'https://api.example.com', apiKey: 'key', model: 'model'},
    };
}

function configured(agents: AgentConfig[]): void {
    mocks.loadConfig.mockReturnValue(agents);
}

/** reset() starts the connections without awaiting them, so their microtasks have to be drained. */
function flush(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function deferredConnection(): {promise: Promise<Connection>; connected: (c: Connection) => void; failed: (e: Error) => void} {
    let connected!: (c: Connection) => void;
    let failed!: (e: Error) => void;
    const promise = new Promise<Connection>((resolve, reject) => {
        connected = resolve;
        failed = reject;
    });
    return {promise, connected, failed};
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
    mocks.connectIM.mockResolvedValue({disconnect: mocks.disconnect});
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

    test('keeps an already connected agent on its connection', async () => {
        configured([newAgent('a1', true)]);
        service.reset();
        await flush();
        service.reset();
        expect(mocks.connectIM).toHaveBeenCalledOnce();
        expect(mocks.disconnect).not.toHaveBeenCalled();
    });

    test('does not start a second attempt while the first one is still connecting', () => {
        mocks.connectIM.mockReturnValue(deferredConnection().promise);
        configured([newAgent('a1', true)]);
        service.reset();
        service.reset();
        expect(mocks.connectIM).toHaveBeenCalledOnce();
    });

    test('disconnects an agent whose im was switched off', async () => {
        configured([newAgent('a1', true)]);
        service.reset();
        await flush();
        configured([newAgent('a1', false)]);
        service.reset();
        expect(mocks.disconnect).toHaveBeenCalledOnce();
    });

    test('connects the agent again after it was switched off and on', async () => {
        configured([newAgent('a1', true)]);
        service.reset();
        await flush();
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

    test('disconnects every running im on shutdown', async () => {
        configured([newAgent('a1', true), newAgent('a2', true)]);
        service.init();
        await flush();
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

    test('remembers the disconnect callback of the connection', async () => {
        await service.connect('a1', 'Ada');
        service.disconnect('a1');
        expect(mocks.disconnect).toHaveBeenCalledOnce();
    });

    test('replaces the connection of an agent that was connected twice', async () => {
        const second = vi.fn<() => void>();
        await service.connect('a1', 'Ada');
        mocks.connectIM.mockResolvedValue({disconnect: second});
        await service.connect('a1', 'Ada');
        service.disconnect('a1');
        expect(second).toHaveBeenCalledOnce();
        expect(mocks.disconnect).not.toHaveBeenCalled();
    });

    test('announces a connected agent by name', async () => {
        await service.connect('a1', 'Ada');
        expect(mocks.sendToast).toHaveBeenCalledWith({key: 'imConnected', data: 'Ada'});
    });

    test('announces a failed connection by name', async () => {
        mocks.connectIM.mockRejectedValue(new Error('handshake refused'));
        await service.connect('a1', 'Ada');
        expect(mocks.sendToast).toHaveBeenCalledWith({key: 'imConnectFailed', data: 'Ada'});
    });

    test('reports why a connection failed', async () => {
        mocks.connectIM.mockRejectedValue(new Error('handshake refused'));
        await service.connect('a1', 'Ada');
        expect(mocks.error.mock.calls[0]![0]).toContain('handshake refused');
    });

    test('frees the agent for another attempt after a failure', async () => {
        mocks.connectIM.mockRejectedValue(new Error('handshake refused'));
        await service.connect('a1', 'Ada');
        mocks.connectIM.mockResolvedValue({disconnect: mocks.disconnect});
        await service.connect('a1', 'Ada');
        service.disconnect('a1');
        expect(mocks.disconnect).toHaveBeenCalledOnce();
    });

    test('closes a connection that lands after the agent was switched off', async () => {
        const late = deferredConnection();
        mocks.connectIM.mockReturnValue(late.promise);
        const connecting = service.connect('a1', 'Ada');
        service.disconnect('a1');
        late.connected({disconnect: mocks.disconnect});
        await connecting;
        expect(mocks.disconnect).toHaveBeenCalledOnce();
        expect(mocks.sendToast).not.toHaveBeenCalled();
    });

    test('keeps the newer connection when an older attempt fails late', async () => {
        const first = deferredConnection();
        const second = deferredConnection();
        mocks.connectIM.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const firstConnect = service.connect('a1', 'Ada');
        service.disconnect('a1');
        const secondConnect = service.connect('a1', 'Ada');

        first.failed(new Error('handshake refused'));
        await firstConnect;
        second.connected({disconnect: mocks.disconnect});
        await secondConnect;

        expect(mocks.disconnect).not.toHaveBeenCalled();
        service.disconnect('a1');
        expect(mocks.disconnect).toHaveBeenCalledOnce();
    });
});

describe('disconnect', () => {

    test('forgets the connection so it is not closed twice', async () => {
        await service.connect('a1', 'Ada');
        service.disconnect('a1');
        service.disconnect('a1');
        expect(mocks.disconnect).toHaveBeenCalledOnce();
    });

    test('ignores an agent that never connected', () => {
        expect(() => service.disconnect('ghost')).not.toThrow();
        expect(mocks.disconnect).not.toHaveBeenCalled();
    });
});
