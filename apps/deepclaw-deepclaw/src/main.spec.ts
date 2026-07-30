import {beforeEach, describe, expect, test, vi} from 'vitest';

const NEXT_BIN = '/web/node_modules/next/dist/bin/next';

type ExitListener = (code: number | null, signal: NodeJS.Signals | null) => void;

type SpawnedChild = {on: (event: string, listener: ExitListener) => void};

const mocks = vi.hoisted(() => ({
    exitListeners: [] as ((code: number | null, signal: NodeJS.Signals | null) => void)[],
    meow: vi.fn<(help: string, options: Record<string, unknown>) => {flags: Record<string, boolean>}>(),
    spawn: vi.fn<(command: string, args: string[], options: Record<string, unknown>) => SpawnedChild>(),
    resolve: vi.fn<(request: string) => string>(),
    createRequire: vi.fn<(path: string | URL) => {resolve: (request: string) => string}>(),
    tuiLoaded: vi.fn<() => void>(),
}));

vi.mock('meow', () => ({default: mocks.meow}));

vi.mock('node:child_process', async (importOriginal) => ({
    ...(await importOriginal<typeof import('node:child_process')>()),
    spawn: mocks.spawn,
}));

vi.mock('node:module', async (importOriginal) => ({
    ...(await importOriginal<typeof import('node:module')>()),
    createRequire: mocks.createRequire,
}));

const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

/**
 * The cli runs its work at import time, so every test needs a fresh module. The terminal app
 * is mocked per test as well, because importing it for real would start the whole ink render.
 */
async function loadCli(flags: Partial<{tui: boolean; web: boolean}> = {}): Promise<void> {
    mocks.meow.mockReturnValue({flags: {tui: false, web: true, ...flags}});
    vi.resetModules();
    vi.doMock('@deepclaw/tui', () => {
        mocks.tuiLoaded();
        return {};
    });
    await import('./main');
}

function meowOptions(): Record<string, unknown> {
    return mocks.meow.mock.calls[0]![1];
}

function spawnCall(): [string, string[], Record<string, unknown>] {
    return mocks.spawn.mock.calls[0]!;
}

function childExit(code: number | null, signal: NodeJS.Signals | null): void {
    mocks.exitListeners[0]!(code, signal);
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.exitListeners.length = 0;
    mocks.resolve.mockReturnValue(NEXT_BIN);
    mocks.createRequire.mockReturnValue({resolve: mocks.resolve});
    mocks.spawn.mockImplementation(() => ({
        on: (event: string, listener: ExitListener) => {
            if (event === 'exit') {
                mocks.exitListeners.push(listener);
            }
        },
    }));
});

describe('command line', () => {

    test('declares the tui and the web flag with their defaults', async () => {
        await loadCli();
        expect(mocks.meow).toHaveBeenCalledOnce();
        expect(meowOptions()['flags']).toEqual({
            tui: {type: 'boolean', optional: true, default: false},
            web: {type: 'boolean', optional: true, default: true},
        });
    });

    test('documents both modes in the usage text', async () => {
        await loadCli();
        const help = mocks.meow.mock.calls[0]![0];
        expect(help).toContain('$ deepclaw');
        expect(help).toContain('--tui');
        expect(help).toContain('--web');
    });

    test('lets meow read the version and the help from this module', async () => {
        await loadCli();
        expect((meowOptions()['importMeta'] as ImportMeta).url).toMatch(/main\.ts$/);
    });
});

describe('web mode', () => {

    test('runs next from the web app folder in the same node', async () => {
        await loadCli({web: true});
        const [command, args, options] = spawnCall();
        expect(command).toBe(process.execPath);
        expect(args).toEqual([NEXT_BIN, 'dev']);
        expect(options['stdio']).toBe('inherit');
        expect(String(options['cwd'])).toMatch(/apps[\\/]deepclaw-web$/);
    });

    test('resolves the next binary through the web app package', async () => {
        await loadCli({web: true});
        expect(String(mocks.createRequire.mock.calls[0]![0])).toMatch(/deepclaw-web[\\/]package\.json$/);
        expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith('next/dist/bin/next');
    });

    test('leaves the tui alone', async () => {
        await loadCli({web: true});
        expect(mocks.tuiLoaded).not.toHaveBeenCalled();
    });

    test('fails when the web app has no next installed', async () => {
        mocks.resolve.mockImplementation(() => {
            throw new Error("Cannot find module 'next/dist/bin/next'");
        });
        await expect(loadCli({web: true})).rejects.toThrow('Cannot find module');
        expect(mocks.spawn).not.toHaveBeenCalled();
    });
});

describe('tui mode', () => {

    test('loads the terminal app instead of next', async () => {
        await loadCli({tui: true, web: false});
        await vi.waitFor(() => expect(mocks.tuiLoaded).toHaveBeenCalledOnce());
        expect(mocks.spawn).not.toHaveBeenCalled();
    });

    test('wins over the web mode when both flags are given', async () => {
        await loadCli({tui: true, web: true});
        await vi.waitFor(() => expect(mocks.tuiLoaded).toHaveBeenCalledOnce());
        expect(mocks.spawn).not.toHaveBeenCalled();
    });

    test('starts nothing when both flags are turned off', async () => {
        await loadCli({tui: false, web: false});
        expect(mocks.spawn).not.toHaveBeenCalled();
        expect(mocks.tuiLoaded).not.toHaveBeenCalled();
    });
});

describe('the next process', () => {

    beforeEach(async () => {
        await loadCli({web: true});
    });

    test('exits with the code of the child', () => {
        childExit(0, null);
        expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    });

    test('reports a failing child with its own code', () => {
        childExit(3, null);
        expect(exit).toHaveBeenCalledExactlyOnceWith(3);
    });

    test('exits with one when the child reports no code', () => {
        childExit(null, null);
        expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    });

    test('kills itself with the signal of the child instead of exiting', () => {
        childExit(null, 'SIGINT');
        expect(kill).toHaveBeenCalledExactlyOnceWith(process.pid, 'SIGINT');
        expect(exit).not.toHaveBeenCalled();
    });
});
