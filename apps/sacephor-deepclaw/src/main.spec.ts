import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

const NEXT_BIN = '/web/node_modules/next/dist/bin/next';

/** The moment a process began, in the clock ticks since the machine came up, as /proc gives it. */
const STARTED_AT = '884512';

/** The same pid begun at another moment, which is a pid handed on to somebody else. */
const BEGUN_LATER = '1902377';

/** The pid the spawned web ui reports, and the one a record read back from disk names. */
const {CHILD_PID} = vi.hoisted(() => ({CHILD_PID: 4321}));

type ExitListener = (code: number | null, signal: NodeJS.Signals | null) => void;

type SpawnedChild = {
    pid?: number,
    unref: () => void,
    on: (event: string, listener: ExitListener) => void,
    once: (event: string, listener: ExitListener) => void,
};

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
    unref: vi.fn<() => void>(),
    mkdirSync: vi.fn<(path: string, options: Record<string, unknown>) => void>(),
    openSync: vi.fn<(path: string, flags: string) => number>(),
    closeSync: vi.fn<(fd: number) => void>(),
    writeFileSync: vi.fn<(path: string, contents: string) => void>(),
    rmSync: vi.fn<(path: string, options: Record<string, unknown>) => void>(),
    execFileSync: vi.fn<(file: string, args: string[], options: Record<string, unknown>) => string>(),
    /** Whether the launcher finds a built web app, a built tui and resources next to itself. */
    installed: false,
    /** What the pid file holds, or nothing when no run left one behind. */
    record: undefined as string | undefined,
    /** The line /proc keeps under a running pid, where the system keeps one at all. */
    procStat: undefined as string | undefined,
    /** The child the spawned web ui is reported as, undefined pid for a start that failed. */
    childPid: CHILD_PID as number | undefined,
    /** The code a spawned server leaves with straight away, where it does not stay up at all. */
    fallsAtOnce: undefined as number | undefined,
}));

vi.mock('meow', () => ({default: mocks.meow}));

vi.mock('node:fs', async (importOriginal) => ({
    ...(await importOriginal<typeof import('node:fs')>()),
    // the only thing the launcher asks about with this is what an installed build carries
    existsSync: () => mocks.installed,
    readFileSync: (path: string) => {
        const answer = String(path).endsWith('deepclaw.pid') ? mocks.record : mocks.procStat;
        if (answer === undefined) {
            throw new Error(`ENOENT: ${path}`);
        }
        return answer;
    },
    mkdirSync: mocks.mkdirSync,
    openSync: mocks.openSync,
    closeSync: mocks.closeSync,
    writeFileSync: mocks.writeFileSync,
    rmSync: mocks.rmSync,
}));

vi.mock('node:child_process', async (importOriginal) => ({
    ...(await importOriginal<typeof import('node:child_process')>()),
    spawn: mocks.spawn,
    execFileSync: mocks.execFileSync,
}));

vi.mock('node:module', async (importOriginal) => ({
    ...(await importOriginal<typeof import('node:module')>()),
    createRequire: mocks.createRequire,
}));

/** The system these tests really run on, put back after any of them pretends otherwise. */
const thisPlatform = process.platform;

/** Held on to before any test fakes the clock, as the one way left to wait for a real moment. */
const realSetTimeout = globalThis.setTimeout;

const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

/**
 * The cli runs its work at import time, so every test needs a fresh module. Both ways to the
 * terminal app are mocked as well, because importing it for real would start the whole ink render.
 */
async function loadCli(cli: Partial<Cli> = {}): Promise<void> {
    mocks.meow.mockReturnValue({
        input: [],
        flags: {tui: false, foreground: false},
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

/** A start that stays in this terminal, which is the one the older flags describe. */
async function loadForeground(flags: Record<string, string | boolean> = {}): Promise<void> {
    await loadCli({input: ['start'], flags: {tui: false, foreground: true, ...flags}});
}

/**
 * A start into the background, watched to its end. The launcher gives the server a moment to fall
 * over before it calls the start a success, and that moment is passed on a fake clock — put in as
 * the server is spawned, which is the last point before the waiting and safely after the loading.
 */
async function loadBackgroundStart(cli: Partial<Cli> = {}): Promise<void> {
    const spawning = mocks.spawn.getMockImplementation()!;
    mocks.spawn.mockImplementation((...args) => {
        vi.useFakeTimers();
        return spawning(...args);
    });
    await onAPushedClock(loadCli({input: ['start'], ...cli}));
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

/**
 * A pid file naming a run of the web ui, as the last start would have written it, and a system
 * that still says the same of that pid. The two are set together because a record only stands for
 * a run while the mark under the pid is the mark that was written down.
 */
function leftBehind(mark: string = STARTED_AT): void {
    mocks.record = JSON.stringify({pid: CHILD_PID, mark});
    systemSays(mark);
}

/**
 * What the system says of that pid now, in whatever shape the system this run believes it is on
 * says it: a line of `/proc` where there is one, the answer of `ps` where there is not, and the
 * row of `tasklist` on windows.
 */
function systemSays(mark: string, program: string = 'node'): void {
    if (process.platform === 'win32') {
        tasklistSays(mark);
        return;
    }
    mocks.procStat = statLine(mark, program);
    mocks.execFileSync.mockReturnValue(mark);
}

/**
 * The line `/proc` keeps under a pid. The name of the program sits in brackets as the second
 * field and is whatever the program called itself, and the moment it began is the twenty-second.
 */
function statLine(startedAt: string, program: string): string {
    return `${CHILD_PID} (${program}) S ${Array(18).fill('0').join(' ')} ${startedAt} 4194304 1234`;
}

/** A system that will not say what a pid is: no /proc to read, or a ps that answers nothing. */
function systemSaysNothing(): void {
    mocks.procStat = undefined;
    mocks.execFileSync.mockImplementation(() => {
        throw new Error('ps: no such process');
    });
}

/**
 * The system this run believes it is on, which decides everything about stopping a run. The module
 * reads it as it loads, so it is set before the cli is loaded and put back after every test.
 */
function pretendPlatform(name: string): void {
    Object.defineProperty(process, 'platform', {value: name, configurable: true});
}

/** What windows says of a pid, which is the name of the program and nothing of its arguments. */
function tasklistSays(program: string): void {
    mocks.execFileSync.mockImplementation((file) => {
        if (file !== 'tasklist') {
            return '';
        }
        return `"${program}","${CHILD_PID}","Console","1","64,000 K"`;
    });
}

/** Turns every question about that pid away, which is how a process that is gone answers. */
function nothingThere(): void {
    kill.mockImplementation((() => {
        throw new Error('ESRCH');
    }) as never);
}

/** A process that is there for the first few questions about it and gone after that. */
function goneAfter(questions: number): void {
    let asked = 0;
    kill.mockImplementation(((_pid: number, signal: number | string) => {
        if (signal === 0 && ++asked > questions) {
            throw new Error('ESRCH');
        }
        return true;
    }) as never);
}

function killedWith(signal: string): boolean {
    return kill.mock.calls.some(([, sent]) => sent === signal);
}

function said(): string {
    return log.mock.calls.map((call) => String(call[0])).join('\n');
}

/**
 * A run watched to its end with the clock pushed on under it. The ten seconds a server is given
 * are only bearable on a fake clock, and a fake clock cannot be in place before the import: it
 * freezes the loading of the module as readily as the wait inside it. So the run puts it in when
 * it comes to the waiting, and this pushes it on from outside, on the real clock until then.
 */
async function onAPushedClock(run: Promise<void>): Promise<void> {
    let running = true;
    const watched = run.finally(() => {
        running = false;
    });
    while (running) {
        await (vi.isFakeTimers()
            ? vi.advanceTimersByTimeAsync(1_000)
            : new Promise((resolve) => realSetTimeout(resolve, 1)));
    }
    await watched;
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.exitListeners.length = 0;
    mocks.installed = false;
    mocks.record = undefined;
    mocks.procStat = undefined;
    mocks.childPid = CHILD_PID;
    mocks.fallsAtOnce = undefined;
    delete process.env['DEEPCLAW_RESOURCES'];
    // Said rather than inherited: how a run is stopped is decided by the system the launcher is
    // on, and tests that leave that to whoever runs them pass or fail by whose machine it is.
    pretendPlatform('linux');
    kill.mockImplementation(() => true);
    mocks.execFileSync.mockReturnValue('');
    mocks.resolve.mockReturnValue(NEXT_BIN);
    mocks.createRequire.mockReturnValue({resolve: mocks.resolve});
    mocks.openSync.mockReturnValue(7);
    mocks.spawn.mockImplementation(() => ({
        pid: mocks.childPid,
        unref: mocks.unref,
        on: (event: string, listener: ExitListener) => {
            if (event === 'exit') {
                mocks.exitListeners.push(listener);
            }
        },
        once: (event: string, listener: ExitListener) => {
            if (event === 'exit' && mocks.fallsAtOnce !== undefined) {
                listener(mocks.fallsAtOnce, null);
            }
        },
    }));
});

describe('command line', () => {

    test('declares the flags of the start command with their defaults', async () => {
        await loadBackgroundStart();
        expect(mocks.meow).toHaveBeenCalledOnce();
        expect(meowOptions()['flags']).toEqual({
            tui: {type: 'boolean', default: false},
            foreground: {type: 'boolean', default: false},
            port: {type: 'string'},
            host: {type: 'string'},
        });
    });

    test('documents both uis and both commands in the usage text', async () => {
        await loadBackgroundStart();
        const help = mocks.meow.mock.calls[0]![0];
        expect(help).toContain('$ deepclaw start');
        expect(help).toContain('$ deepclaw stop');
        expect(help).toContain('--tui');
        expect(help).toContain('--foreground');
    });

    test('lets meow read the version and the help from this module', async () => {
        await loadBackgroundStart();
        expect((meowOptions()['importMeta'] as ImportMeta).url).toMatch(/main\.ts$/);
    });

    test('starts the web ui when no command is given', async () => {
        await loadBackgroundStart({input: []});
        expect(mocks.spawn).toHaveBeenCalledOnce();
    });

    test('says which command it does not know and shows what it does know', async () => {
        await loadCli({input: ['stat']});
        expect(error).toHaveBeenCalledWith(expect.stringContaining('stat'));
        expect(mocks.showHelp).toHaveBeenCalledExactlyOnceWith(1);
        expect(mocks.spawn).not.toHaveBeenCalled();
    });
});

describe('web ui of a checkout', () => {

    test('runs next in dev mode from the web app folder in the same node', async () => {
        await loadForeground();
        const [command, args, options] = spawnCall();
        expect(command).toBe(process.execPath);
        expect(args).toEqual([NEXT_BIN, 'dev', '--hostname', '127.0.0.1']);
        expect(options['stdio']).toBe('inherit');
        expect(String(options['cwd'])).toMatch(/apps[\\/]deepclaw-web$/);
    });

    /** The dev server of next takes the address as arguments rather than out of the environment. */
    test('hands the address it was given to the dev server', async () => {
        await loadForeground({port: '4300', host: '127.0.0.1'});
        expect(spawnCall()[1]).toEqual([NEXT_BIN, 'dev', '--port', '4300', '--hostname', '127.0.0.1']);
    });

    test('resolves the next binary through the web app package', async () => {
        await loadForeground();
        expect(String(mocks.createRequire.mock.calls[0]![0])).toMatch(/deepclaw-web[\\/]package\.json$/);
        expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith('next/dist/bin/next');
    });

    test('names no resources, the code of a checkout finds its own', async () => {
        await loadForeground();
        expect(spawnedEnv()['DEEPCLAW_RESOURCES']).toBeUndefined();
    });

    test('leaves the tui alone', async () => {
        await loadForeground();
        expect(mocks.tuiLoaded).not.toHaveBeenCalled();
    });

    test('fails when the web app has no next installed', async () => {
        mocks.resolve.mockImplementation(() => {
            throw new Error("Cannot find module 'next/dist/bin/next'");
        });
        await expect(loadForeground()).rejects.toThrow('Cannot find module');
        expect(mocks.spawn).not.toHaveBeenCalled();
    });
});

describe('web ui of an installed build', () => {

    beforeEach(() => {
        mocks.installed = true;
    });

    test('runs the server that was built into the package', async () => {
        await loadForeground();
        const [command, args, options] = spawnCall();
        expect(command).toBe(process.execPath);
        expect(args[0]).toMatch(/web[\\/]apps[\\/]deepclaw-web[\\/]server\.js$/);
        expect(String(options['cwd'])).toMatch(/web[\\/]apps[\\/]deepclaw-web$/);
        expect(mocks.createRequire).not.toHaveBeenCalled();
    });

    /** Bundled code has lost sight of the folder its resources were shipped in. */
    test('names the resources it was shipped with', async () => {
        await loadForeground();
        expect(spawnedEnv()['DEEPCLAW_RESOURCES']).toMatch(/deepclaw[\\/]resources$/);
    });
});

describe('address of the web ui', () => {

    test('passes the port along', async () => {
        await loadForeground({port: '4300'});
        expect(spawnedEnv()['PORT']).toBe('4300');
    });

    test('leaves the port to the server when none is given', async () => {
        await loadForeground();
        expect(spawnedEnv()['PORT']).toBeUndefined();
    });

    /**
     * The web ui asks for no password, so it is kept to the machine it runs on until someone
     * asks for otherwise. A shell exports a HOSTNAME of its own, which would decide this instead.
     */
    test('binds nothing but the local address unless another is named', async () => {
        await loadForeground();
        expect(spawnedEnv()['HOSTNAME']).toBe('127.0.0.1');
    });

    test('binds the address that is named', async () => {
        await loadForeground({host: '127.0.0.1'});
        expect(spawnedEnv()['HOSTNAME']).toBe('127.0.0.1');
    });
});

describe('terminal ui', () => {

    test('loads the workspace app of a checkout instead of next', async () => {
        await loadCli({input: ['start'], flags: {tui: true}});
        await vi.waitFor(() => expect(mocks.tuiLoaded).toHaveBeenCalledExactlyOnceWith('@deepclaw/tui'));
        expect(mocks.spawn).not.toHaveBeenCalled();
    });

    /** A terminal ui has nowhere to go behind you, so it is run in front of you either way. */
    test('stays in this terminal although nothing asked for the foreground', async () => {
        await loadCli({input: ['start'], flags: {tui: true, foreground: false}});
        await vi.waitFor(() => expect(mocks.tuiLoaded).toHaveBeenCalledOnce());
        expect(mocks.writeFileSync).not.toHaveBeenCalled();
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

describe('the web process in front of you', () => {

    beforeEach(async () => {
        await loadForeground();
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

describe('the web process behind you', () => {

    test('starts it detached and lets go of it', async () => {
        await loadBackgroundStart();
        const options = spawnCall()[2];
        expect(options['detached']).toBe(true);
        expect(mocks.unref).toHaveBeenCalledOnce();
        expect(exit).not.toHaveBeenCalled();
    });

    /** Whatever the server says on the one morning it does not come up has to land somewhere. */
    test('sends what it says to a console log of its own, written from the top', async () => {
        await loadBackgroundStart();
        expect(mocks.openSync).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/console\.log$/), 'w');
        expect(spawnCall()[2]['stdio']).toEqual(['ignore', 7, 7]);
        // the child was handed its own copy, and this one would keep the launcher from leaving
        expect(mocks.closeSync).toHaveBeenCalledExactlyOnceWith(7);
    });

    test('writes down the pid and the mark the system gives it', async () => {
        systemSays(STARTED_AT);
        await loadBackgroundStart();
        const [path, contents] = mocks.writeFileSync.mock.calls[0]!;
        expect(String(path)).toMatch(/deepclaw\.pid$/);
        expect(JSON.parse(String(contents))).toEqual({pid: CHILD_PID, mark: STARTED_AT});
    });

    /** A record of a pid and nothing else is one no later stop will act on, and it says so then. */
    test('writes down no mark where the system would give none', async () => {
        systemSaysNothing();
        await loadBackgroundStart();
        expect(JSON.parse(String(mocks.writeFileSync.mock.calls[0]![1]))).toEqual({pid: CHILD_PID, mark: ''});
    });

    test('names the address, the pid and the way to stop it', async () => {
        await loadBackgroundStart({flags: {tui: false, foreground: false, port: '4300'}});
        expect(said()).toContain('http://127.0.0.1:4300');
        expect(said()).toContain(String(CHILD_PID));
        expect(said()).toContain('deepclaw stop');
    });

    test('names the port the server takes when none was asked for', async () => {
        await loadBackgroundStart();
        expect(said()).toContain('http://127.0.0.1:3000');
    });

    /**
     * The console is no longer inherited, so a port already taken would otherwise be reported as
     * an address to visit and only be found out at the next stop.
     */
    test('reports a server that stops as soon as it starts, and clears its record', async () => {
        mocks.fallsAtOnce = 1;
        await loadBackgroundStart();
        expect(error).toHaveBeenCalledWith(expect.stringContaining('console.log'));
        expect(mocks.rmSync).toHaveBeenCalledWith(expect.stringMatching(/deepclaw\.pid$/), {force: true});
        expect(exit).toHaveBeenCalledExactlyOnceWith(1);
        expect(said()).not.toContain('running on');
    });

    test('refuses to start a second one beside the one already running', async () => {
        leftBehind();
        await loadBackgroundStart();
        expect(error).toHaveBeenCalledWith(expect.stringContaining('already running'));
        expect(exit).toHaveBeenCalledExactlyOnceWith(1);
        expect(mocks.spawn).not.toHaveBeenCalled();
    });

    test('starts over a record whose process is gone', async () => {
        leftBehind();
        nothingThere();
        await loadBackgroundStart();
        expect(mocks.spawn).toHaveBeenCalledOnce();
        expect(error).not.toHaveBeenCalled();
    });

    /** The pid outlived the run that wrote it and belongs to something else now. */
    test('starts over a record whose pid began again after it was written', async () => {
        leftBehind();
        systemSays(BEGUN_LATER);
        await loadBackgroundStart();
        expect(mocks.spawn).toHaveBeenCalledOnce();
    });

    /** Two servers on one port and one folder of data is not a thing to risk on a guess. */
    test('refuses to start when the system will not say what the pid is', async () => {
        leftBehind();
        systemSaysNothing();
        await loadBackgroundStart();
        expect(error).toHaveBeenCalledWith(expect.stringContaining('deepclaw.pid'));
        expect(exit).toHaveBeenCalledExactlyOnceWith(1);
        expect(mocks.spawn).not.toHaveBeenCalled();
    });

    test('leaves no record behind when the web ui could not be started', async () => {
        mocks.childPid = undefined;
        await loadBackgroundStart();
        expect(mocks.writeFileSync).not.toHaveBeenCalled();
        expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    });
});

describe('stopping what runs behind you', () => {

    test('says so when nothing was left running', async () => {
        await loadCli({input: ['stop']});
        expect(said()).toContain('not running');
        expect(kill).not.toHaveBeenCalled();
    });

    test('clears a record whose process is already gone', async () => {
        leftBehind();
        nothingThere();
        await loadCli({input: ['stop']});
        expect(said()).toContain('not running');
        expect(mocks.rmSync).toHaveBeenCalledWith(expect.stringMatching(/deepclaw\.pid$/), {force: true});
        expect(killedWith('SIGTERM')).toBe(false);
    });

    test('asks the server to close and clears the record once it has', async () => {
        leftBehind();
        goneAfter(1);
        await loadCli({input: ['stop']});
        expect(kill).toHaveBeenCalledWith(CHILD_PID, 'SIGTERM');
        expect(killedWith('SIGKILL')).toBe(false);
        expect(mocks.rmSync).toHaveBeenCalledWith(expect.stringMatching(/deepclaw\.pid$/), {force: true});
        expect(said()).toContain('stopped');
    });

    test('takes down a server that will not close of its own accord', async () => {
        leftBehind();
        // the clock is faked on the signal, which is the last moment before the waiting begins
        kill.mockImplementation(((_pid: number, signal: number | string) => {
            if (signal === 'SIGTERM') {
                vi.useFakeTimers();
            }
            return true;
        }) as never);
        await onAPushedClock(loadCli({input: ['stop']}));
        expect(killedWith('SIGKILL')).toBe(true);
        expect(mocks.rmSync).toHaveBeenCalledWith(expect.stringMatching(/deepclaw\.pid$/), {force: true});
        expect(said()).toContain('killed');
    });

    /**
     * Ten seconds is long enough for the pid to have gone and been handed to somebody else, and
     * SIGKILL is not a thing to send on an answer that old.
     */
    test('kills nothing when the pid has moved on while it waited', async () => {
        leftBehind();
        kill.mockImplementation(((_pid: number, signal: number | string) => {
            if (signal === 'SIGTERM') {
                systemSays(BEGUN_LATER);
                vi.useFakeTimers();
            }
            return true;
        }) as never);
        await onAPushedClock(loadCli({input: ['stop']}));
        expect(killedWith('SIGKILL')).toBe(false);
        expect(said()).toContain('stopped');
    });

    /** The last answer of the wait is read like every other: no name, no kill, no clearing. */
    test('kills nothing when the system stops naming the pid during the wait', async () => {
        leftBehind();
        kill.mockImplementation(((_pid: number, signal: number | string) => {
            if (signal === 'SIGTERM') {
                systemSaysNothing();
                vi.useFakeTimers();
            }
            return true;
        }) as never);
        await onAPushedClock(loadCli({input: ['stop']}));
        expect(killedWith('SIGKILL')).toBe(false);
        expect(mocks.rmSync).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledWith(expect.stringContaining('deepclaw.pid'));
        expect(said()).not.toContain('stopped');
    });

    /** A record of a pid that belongs to something else now is a record, not a target. */
    test('signals nothing when the pid began again after the record was written', async () => {
        leftBehind();
        systemSays(BEGUN_LATER);
        await loadCli({input: ['stop']});
        expect(killedWith('SIGTERM')).toBe(false);
        expect(mocks.rmSync).toHaveBeenCalledOnce();
    });

    /**
     * The bug this mark exists for. The server renames itself as it comes up — next sets a process
     * title, and node writes that into the memory the command line is read out of — so a record
     * that held the command line matched nothing afterwards, and stop cleared the record of a
     * server it left running. The moment the process began is the thing the renaming cannot touch.
     */
    test('stops a server that renamed itself since it was started', async () => {
        leftBehind();
        systemSays(STARTED_AT, 'next-server (v16.2.6)');
        goneAfter(1);
        await loadCli({input: ['stop']});
        expect(kill).toHaveBeenCalledWith(CHILD_PID, 'SIGTERM');
        expect(said()).toContain('stopped');
    });

    /** A record of a start the system would say nothing about is not one to signal on either. */
    test('signals nothing on a record that was written with no mark', async () => {
        mocks.record = JSON.stringify({pid: CHILD_PID, mark: ''});
        systemSays(STARTED_AT);
        await loadCli({input: ['stop']});
        expect(killedWith('SIGTERM')).toBe(false);
        expect(mocks.rmSync).not.toHaveBeenCalled();
        expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    });

    /**
     * The record is left where it is and the pid is handed to the user instead. Signalling a pid
     * nothing can vouch for is the one outcome worse than a stop that did not happen.
     */
    test('signals nothing and says so when the system will not name the pid', async () => {
        leftBehind();
        systemSaysNothing();
        await loadCli({input: ['stop']});
        expect(error).toHaveBeenCalledWith(expect.stringContaining(String(CHILD_PID)));
        expect(error).toHaveBeenCalledWith(expect.stringContaining('deepclaw.pid'));
        expect(kill).not.toHaveBeenCalledWith(CHILD_PID, 'SIGTERM');
        expect(mocks.rmSync).not.toHaveBeenCalled();
        expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    });

    /** No /proc to read there, and ps is what says when a process began instead. */
    test('asks ps on a system that keeps no proc to read', async () => {
        pretendPlatform('darwin');
        leftBehind('Sat Aug 29 20:15:01 2026');
        goneAfter(1);
        await loadCli({input: ['stop']});
        expect(mocks.execFileSync).toHaveBeenCalledWith(
            'ps', ['-p', String(CHILD_PID), '-o', 'lstart='], expect.anything());
        expect(kill).toHaveBeenCalledWith(CHILD_PID, 'SIGTERM');
    });

    /** A process that goes exactly then is a stop that worked, not a stack to read. */
    test('says nothing of a process that goes between the asking and the signal', async () => {
        leftBehind();
        let asked = 0;
        kill.mockImplementation(((_pid: number, signal: number | string) => {
            if (signal === 0 && ++asked > 1) {
                throw new Error('ESRCH');
            }
            if (signal === 'SIGTERM') {
                throw new Error('ESRCH');
            }
            return true;
        }) as never);
        await loadCli({input: ['stop']});
        expect(said()).toContain('stopped');
        expect(error).not.toHaveBeenCalled();
    });

    test('reads a record it cannot make sense of as nothing running', async () => {
        mocks.record = 'not json';
        await loadCli({input: ['stop']});
        expect(said()).toContain('not running');
        expect(mocks.rmSync).not.toHaveBeenCalled();
    });
});

describe('on windows', () => {

    /** All windows will say of a pid cheaply is the program, so the program is what is marked. */
    const NODE = 'node.exe';

    beforeEach(() => {
        pretendPlatform('win32');
        tasklistSays(NODE);
    });

    /** A detached start is otherwise a console window opening on a server nobody watches. */
    test('opens no window for the server it leaves running', async () => {
        pretendPlatform('linux');
        await loadBackgroundStart();
        expect(spawnCall()[2]['windowsHide']).toBe(true);
    });

    /** Nothing there takes its children with it, and the workers would keep holding the port. */
    test('stops the whole tree, having no signal to ask with', async () => {
        leftBehind(NODE);
        await loadCli({input: ['stop']});
        expect(mocks.execFileSync).toHaveBeenCalledWith(
            'taskkill', ['/pid', String(CHILD_PID), '/t', '/f'], expect.anything());
        expect(killedWith('SIGTERM')).toBe(false);
        expect(mocks.rmSync).toHaveBeenCalledWith(expect.stringMatching(/deepclaw\.pid$/), {force: true});
        expect(said()).toContain('stopped');
    });

    test('leaves the record as it was when the tree would not go', async () => {
        leftBehind(NODE);
        mocks.execFileSync.mockImplementation((file) => {
            if (file === 'taskkill') {
                throw new Error('taskkill: access denied');
            }
            return `"${NODE}","${CHILD_PID}","Console","1","64,000 K"`;
        });
        await loadCli({input: ['stop']});
        expect(error).toHaveBeenCalledWith(expect.stringContaining('would not be stopped'));
        expect(exit).toHaveBeenCalledExactlyOnceWith(1);
        expect(mocks.rmSync).not.toHaveBeenCalled();
    });

    /** The program is all windows will say of a pid, and it still tells a node from a service. */
    test('asks what the pid is now before signalling anything', async () => {
        leftBehind(NODE);
        await loadCli({input: ['stop']});
        expect(mocks.execFileSync).toHaveBeenCalledWith(
            'tasklist', ['/fi', `pid eq ${CHILD_PID}`, '/fo', 'csv', '/nh'], expect.anything());
    });

    test('starts over a record whose pid is another program now', async () => {
        leftBehind(NODE);
        tasklistSays('svchost.exe');
        await loadBackgroundStart();
        expect(mocks.spawn).toHaveBeenCalledOnce();
        expect(error).not.toHaveBeenCalled();
    });

    /**
     * A pid something holds and tasklist prints no row for is the answer nobody has: the line it
     * prints instead names no program, and a start beside a server that may be up is not a thing
     * to risk on it.
     */
    test('refuses to start where the pid is taken and tasklist names no program', async () => {
        leftBehind(NODE);
        mocks.execFileSync.mockReturnValue('INFO: No tasks are running which match the specified criteria.');
        await loadBackgroundStart();
        expect(error).toHaveBeenCalledWith(expect.stringContaining('will not say'));
        expect(mocks.spawn).not.toHaveBeenCalled();
    });

    test('refuses to start beside the run its record still names', async () => {
        leftBehind(NODE);
        await loadBackgroundStart();
        expect(error).toHaveBeenCalledWith(expect.stringContaining('already running'));
        expect(mocks.spawn).not.toHaveBeenCalled();
    });
});

afterEach(() => {
    pretendPlatform(thisPlatform);
    vi.useRealTimers();
});
