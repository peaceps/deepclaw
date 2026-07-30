import {beforeEach, describe, expect, test, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    pino: vi.fn<(options: object) => object>(),
    child: vi.fn<(bindings: object) => object>(),
}));

vi.mock('pino', () => ({default: mocks.pino}));

type GetLogger = (typeof import('./logger'))['getLogger'];

/** The root logger is cached in the module, so every test starts from a fresh module. */
async function loadGetLogger(): Promise<GetLogger> {
    vi.resetModules();
    return (await import('./logger')).getLogger;
}

function rootOptions(): {level: string; browser: {asObject: boolean; serialize: boolean; write: unknown}} {
    return mocks.pino.mock.calls[0]![0] as ReturnType<typeof rootOptions>;
}

let getLogger: GetLogger;

beforeEach(async () => {
    vi.clearAllMocks();
    mocks.pino.mockReturnValue({child: mocks.child});
    mocks.child.mockImplementation(bindings => bindings);
    getLogger = await loadGetLogger();
});

describe('getLogger', () => {

    test('names the logger it hands out', () => {
        expect(getLogger('SSEServer')).toEqual({name: 'SSEServer'});
        expect(mocks.child).toHaveBeenCalledWith({name: 'SSEServer'});
    });

    test('keeps the root logger at the info level', () => {
        getLogger('SSEServer');
        expect(rootOptions().level).toBe('info');
    });

    test('writes browser logs as serialized objects through the console', () => {
        getLogger('SSEServer');
        expect(rootOptions().browser).toEqual({asObject: true, serialize: true, write: console.log});
    });

    test('builds the root logger only once for several names', () => {
        getLogger('SSEServer');
        getLogger('InfoClient');
        expect(mocks.pino).toHaveBeenCalledOnce();
        expect(mocks.child).toHaveBeenCalledTimes(2);
    });

    test('does not build the root logger before the first name is asked for', () => {
        expect(mocks.pino).not.toHaveBeenCalled();
    });

    test('gives the same name its own child every time', () => {
        getLogger('SSEServer');
        getLogger('SSEServer');
        expect(mocks.child).toHaveBeenCalledTimes(2);
    });
});
