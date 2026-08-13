import {beforeEach, describe, expect, test, vi} from 'vitest';

const NEXT_BIN = '/web/node_modules/next/dist/bin/next';

type ExitListener = (code: number | null, signal: NodeJS.Signals | null) => void;

type SpawnedChild = {on: (event: string, listener: ExitListener) => void};

type Cli = {
    input: string[],
    flags: Record<string, string | boolean | undefined>,
    showHelp: (code: number) => void,
};

const mocks = vi.hoisted(() => ({
    exitListeners: [] as ExitListener[],
    meow: vi.fn<(help: string, options: Record<string, unknown>) => unknown>(),
    spawn: vi.fn<(command: string, args: string[], options: Record<string, unknown>) => SpawnedChild>(),
    resolve: vi.fn<(request: string) => string>(),
    createRequire: vi.fn<(path: string | URL) => {resolve: (request: string) => string}>(),
    showHelp: vi.fn<(code: number) => void>(),
    tuiLoaded: vi.fn<(from: string) => void>(),
    /** Whether the launcher finds a built web app, a built tui and resources next to itself. */
    installed: false,
}));

vi.mock('meow', () => ({default: mocks.meow}));

vi.mock('node:fs', async (importOriginal) => ({
    ...(await importOriginal<typeof import('node:fs')>()),
    // the only thing the launcher asks about is what an installed build carries
    existsSync: () => mocks.installed,
}));

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
const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

/**
 * The cli runs its work at import time, so every test needs a fresh module. Both ways to the
 * terminal app are mocked as well, because importing it for real would start the whole ink render.
 */
async function loadCli(cli: Partial<Cli> = {}): Promise<void> {
    mocks.meow.mockReturnValue({
        input: [],
        flags: {tui: false},
        showHelp: mocks.showHelp,
        ...cli,
    });
    vi.resetModules();
    vi.doMock('@deepclaw/tui', () => {
        mocks.tuiLoaded('@deepclaw/tui');
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

function spawnedEnv(): Record<string, string> {
    return spawnCall()[2]['env'] as Record<string, string>;
}

function childExit(code: number | null, signal: NodeJS.Signals | null): void {
    mocks.exitListeners[0]!(code, signal);
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.exitListeners.length = 0;
    mocks.installed = false;
    delete process.env['DEEPCLAW_RESOURCES'];
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

    test('declares the flags of the start command with their defaults', async () => {
        await loadCli();
        expect(mocks.meow).toHaveBeenCalledOnce();
        expect(meowOptions()['flags']).toEqual({
            tui: {type: 'boolean', default: false},
            port: {type: 'string'},
            host: {type: 'string'},
        });
    });

    test('documents both uis in the usage text', async () => {
        await loadCli();
        const help = mocks.meow.mock.calls[0]![0];
        expect(help).toContain('$ deepclaw start');
        expect(help).toContain('--tui');
    });

    test('lets meow read the version and the help from this module', async () => {
        await loadCli();
        expect((meowOptions()['importMeta'] as ImportMeta).url).toMatch(/main\.ts$/);
    });

    test('starts the web ui when no command is given', async () => {
        await loadCli({input: []});
        expect(mocks.spawn).toHaveBeenCalledOnce();
    });

    test('says which command it does not know and shows what it does know', async () => {
        await loadCli({input: ['stat']});
        expect(error).toHaveBeenCalledWith(expect.stringContaining('stat'));
        expect(mocks.showHelp).toHaveBeenCalledExactlyOnceWith(1);
    });
});

describe('web ui of a checkout', () => {

    test('runs next in dev mode from the web app folder in the same node', async () => {
        await loadCli({input: ['start']});
        const [command, args, options] = spawnCall();
        expect(command).toBe(process.execPath);
        expect(args).toEqual([NEXT_BIN, 'dev', '--hostname', '127.0.0.1']);
        expect(options['stdio']).toBe('inherit');
        expect(String(options['cwd'])).toMatch(/apps[\\/]deepclaw-web$/);
    });

    /** The dev server of next takes the address as arguments rather than out of the environment. */
    test('hands the address it was given to the dev server', async () => {
        await loadCli({input: ['start'], flags: {tui: false, port: '4300', host: '127.0.0.1'}});
        expect(spawnCall()[1]).toEqual([NEXT_BIN, 'dev', '--port', '4300', '--hostname', '127.0.0.1']);
    });

    test('resolves the next binary through the web app package', async () => {
        await loadCli({input: ['start']});
        expect(String(mocks.createRequire.mock.calls[0]![0])).toMatch(/deepclaw-web[\\/]package\.json$/);
        expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith('next/dist/bin/next');
    });

    test('names no resources, the code of a checkout finds its own', async () => {
        await loadCli({input: ['start']});
        expect(spawnedEnv()['DEEPCLAW_RESOURCES']).toBeUndefined();
    });

    test('leaves the tui alone', async () => {
        await loadCli({input: ['start']});
        expect(mocks.tuiLoaded).not.toHaveBeenCalled();
    });

    test('fails when the web app has no next installed', async () => {
        mocks.resolve.mockImplementation(() => {
            throw new Error("Cannot find module 'next/dist/bin/next'");
        });
        await expect(loadCli({input: ['start']})).rejects.toThrow('Cannot find module');
        expect(mocks.spawn).not.toHaveBeenCalled();
    });
});

describe('web ui of an installed build', () => {

    beforeEach(() => {
        mocks.installed = true;
    });

    test('runs the server that was built into the package', async () => {
        await loadCli({input: ['start']});
        const [command, args, options] = spawnCall();
        expect(command).toBe(process.execPath);
        expect(args[0]).toMatch(/web[\\/]apps[\\/]deepclaw-web[\\/]server\.js$/);
        expect(String(options['cwd'])).toMatch(/web[\\/]apps[\\/]deepclaw-web$/);
        expect(mocks.createRequire).not.toHaveBeenCalled();
    });

    /** Bundled code has lost sight of the folder its resources were shipped in. */
    test('names the resources it was shipped with', async () => {
        await loadCli({input: ['start']});
        expect(spawnedEnv()['DEEPCLAW_RESOURCES']).toMatch(/deepclaw[\\/]resources$/);
    });
});

describe('address of the web ui', () => {

    test('passes the port along', async () => {
        await loadCli({input: ['start'], flags: {tui: false, port: '4300'}});
        expect(spawnedEnv()['PORT']).toBe('4300');
    });

    test('leaves the port to the server when none is given', async () => {
        await loadCli({input: ['start']});
        expect(spawnedEnv()['PORT']).toBeUndefined();
    });

    /**
     * The web ui asks for no password, so it is kept to the machine it runs on until someone
     * asks for otherwise. A shell exports a HOSTNAME of its own, which would decide this instead.
     */
    test('binds nothing but the local address unless another is named', async () => {
        await loadCli({input: ['start']});
        expect(spawnedEnv()['HOSTNAME']).toBe('127.0.0.1');
    });

    test('binds the address that is named', async () => {
        await loadCli({input: ['start'], flags: {tui: false, host: '127.0.0.1'}});
        expect(spawnedEnv()['HOSTNAME']).toBe('127.0.0.1');
    });
});

describe('terminal ui', () => {

    test('loads the workspace app of a checkout instead of next', async () => {
        await loadCli({input: ['start'], flags: {tui: true}});
        await vi.waitFor(() => expect(mocks.tuiLoaded).toHaveBeenCalledExactlyOnceWith('@deepclaw/tui'));
        expect(mocks.spawn).not.toHaveBeenCalled();
    });

    /**
     * An installed build reaches for the bundle beside it rather than for a package it could
     * never resolve. A checkout has no such bundle, so what it looked for is what it reports.
     */
    test('loads the bundle that sits next to it in an installed build', async () => {
        mocks.installed = true;
        await expect(loadCli({input: ['start'], flags: {tui: true}})).rejects.toThrow(/tui\.js/);
        expect(mocks.tuiLoaded).not.toHaveBeenCalled();
    });

    /** The tui shares this process, so what it reads has to be named before it loads. */
    test('names the resources it was shipped with before loading', async () => {
        mocks.installed = true;
        await expect(loadCli({input: ['start'], flags: {tui: true}})).rejects.toThrow();
        expect(process.env['DEEPCLAW_RESOURCES']).toMatch(/deepclaw[\\/]resources$/);
    });
});

describe('the web process', () => {

    beforeEach(async () => {
        await loadCli({input: ['start']});
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
