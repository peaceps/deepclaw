import {beforeEach, describe, expect, test, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    initGateway: vi.fn<() => void>(),
    initIM: vi.fn<() => void>(),
}));

vi.mock('@deepclaw/loop-gateway', () => ({LoopGateway: {initGateway: mocks.initGateway}}));

vi.mock('@/im/im-service', () => ({IMService: {init: mocks.initIM}}));

async function boot(): Promise<void> {
    vi.resetModules();
    await import('./server-init');
}

beforeEach(() => {
    vi.resetAllMocks();
});

describe('server-init', () => {

    test('starts the gateway', async () => {
        await boot();
        expect(mocks.initGateway).toHaveBeenCalledOnce();
    });

    test('starts the im connections', async () => {
        await boot();
        expect(mocks.initIM).toHaveBeenCalledOnce();
    });

    test('starts the gateway before the im connections', async () => {
        await boot();
        expect(mocks.initGateway.mock.invocationCallOrder[0]!)
            .toBeLessThan(mocks.initIM.mock.invocationCallOrder[0]!);
    });

    test('boots only once however often it is imported', async () => {
        await boot();
        await import('./server-init');
        expect(mocks.initGateway).toHaveBeenCalledOnce();
    });

    test('leaves the im connections closed when the gateway cannot start', async () => {
        mocks.initGateway.mockImplementation(() => {
            throw new Error('gateway down');
        });
        await expect(boot()).rejects.toThrow('gateway down');
        expect(mocks.initIM).not.toHaveBeenCalled();
    });
});
