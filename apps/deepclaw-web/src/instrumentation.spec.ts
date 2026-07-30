import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    initGateway: vi.fn<() => void>(),
    initIM: vi.fn<() => void>(),
}));

vi.mock('@deepclaw/loop-gateway', () => ({LoopGateway: {initGateway: mocks.initGateway}}));

vi.mock('@/im/im-service', () => ({IMService: {init: mocks.initIM}}));

async function register(): Promise<void> {
    vi.resetModules();
    return (await import('./instrumentation')).register();
}

beforeEach(() => {
    vi.resetAllMocks();
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('register', () => {

    test('boots the server in the node runtime', async () => {
        vi.stubEnv('NEXT_RUNTIME', 'nodejs');
        await register();
        expect(mocks.initGateway).toHaveBeenCalledOnce();
        expect(mocks.initIM).toHaveBeenCalledOnce();
    });

    test('leaves the edge runtime without a server bootstrap', async () => {
        vi.stubEnv('NEXT_RUNTIME', 'edge');
        await register();
        expect(mocks.initGateway).not.toHaveBeenCalled();
    });

    test('leaves an unnamed runtime without a server bootstrap', async () => {
        vi.stubEnv('NEXT_RUNTIME', undefined);
        await register();
        expect(mocks.initGateway).not.toHaveBeenCalled();
    });

    test('boots only once when it is called twice', async () => {
        vi.stubEnv('NEXT_RUNTIME', 'nodejs');
        vi.resetModules();
        const {register: registerTwice} = await import('./instrumentation');
        await registerTwice();
        await registerTwice();
        expect(mocks.initGateway).toHaveBeenCalledOnce();
    });

    test('reports a bootstrap that failed', async () => {
        vi.stubEnv('NEXT_RUNTIME', 'nodejs');
        mocks.initGateway.mockImplementation(() => {
            throw new Error('gateway down');
        });
        await expect(register()).rejects.toThrow('gateway down');
    });
});
