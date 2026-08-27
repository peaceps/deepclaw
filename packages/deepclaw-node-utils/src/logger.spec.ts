import {describe, expect, test, vi} from 'vitest';
import {MAX_LOG_FILES} from './logger';

const mocks = vi.hoisted(() => {
    const workingDir = '/home/deepclaw';
    const write = vi.fn();
    const child = vi.fn((bindings: Record<string, unknown>) => ({
        bindings, level: 'debug', info: write, warn: write, error: write,
    }));
    const root = vi.fn<(config: unknown) => {child: typeof child}>(() => ({child}));
    return {
        workingDir, write, child, root,
        getWorkingDir: vi.fn(() => workingDir),
        timestamp: vi.fn(() => '20260101000000000'),
        enforceFileCountLimit: vi.fn<
            (folder: string, limit: number, keep?: (fileName: string) => boolean) => void
        >(() => undefined),
    };
});

/** The one value the module and the assertions have to agree on, so there is one of it. */
const WORKING_DIR = mocks.workingDir;

vi.mock('pino', () => {
    const pino = mocks.root as unknown as {stdTimeFunctions: {isoTime: () => string}};
    pino.stdTimeFunctions = {isoTime: () => '2026-01-01T00:00:00.000Z'};
    return {default: pino};
});

vi.mock('./file-utils', () => ({
    FileUtils: {
        getWorkingDir: mocks.getWorkingDir,
        timestamp: mocks.timestamp,
        enforceFileCountLimit: mocks.enforceFileCountLimit,
    },
}));

/** The module holds the one logger of a process, so each test is given a process of its own. */
async function loadLogger() {
    vi.resetModules();
    vi.clearAllMocks();
    return await import('./logger');
}

describe('getLogger', () => {

    test('binds the given name on a child logger', async () => {
        const {getLogger} = await loadLogger();
        getLogger('mcp-service').info('hello');
        expect(mocks.child).toHaveBeenCalledWith({name: 'mcp-service'});
    });

    test('writes what it was given through to the logger behind it', async () => {
        const {getLogger} = await loadLogger();
        getLogger('mcp-service').error('it broke');
        expect(mocks.write).toHaveBeenCalledExactlyOnceWith('it broke');
    });

    /** Reading is asking as much as writing is: whoever reads a level wants the real one. */
    test('answers for what is not a method off the logger behind it', async () => {
        const {getLogger} = await loadLogger();
        expect(getLogger('mcp-service').level).toBe('debug');
    });

    /** It stands in for the logger, so what the logger has it has. */
    test('owns up to the methods of the logger behind it', async () => {
        const {getLogger} = await loadLogger();
        expect('info' in getLogger('mcp-service')).toBe(true);
        expect('nonsense' in getLogger('mcp-service')).toBe(false);
    });

    /** A method of a logger is a thing somebody may hold on to, or hand over, or compare. */
    test('hands out the same method every time it is asked for', async () => {
        const {getLogger} = await loadLogger();
        const logger = getLogger('mcp-service');
        expect(logger.info).toBe(logger.info);
    });
});

describe('getLoopLogger', () => {

    test('binds the loop id and the run id on a child logger', async () => {
        const {getLoopLogger} = await loadLogger();
        getLoopLogger('agent.a1', 'sub1').info('running');
        expect(mocks.child).toHaveBeenCalledWith({loopId: 'agent.a1', runId: 'sub1'});
    });

    test('leaves the run id undefined when it is not given', async () => {
        const {getLoopLogger} = await loadLogger();
        getLoopLogger('agent.a1').info('running');
        expect(mocks.child).toHaveBeenCalledWith({loopId: 'agent.a1', runId: undefined});
    });
});

describe('root logger', () => {

    test('is created once and shared by every child', async () => {
        const {getLogger, getLoopLogger} = await loadLogger();
        getLogger('one').info('a');
        getLogger('two').warn('b');
        getLoopLogger('agent.a1').error('c');
        expect(mocks.root).toHaveBeenCalledOnce();
    });

    /**
     * A logger is asked for where a module is imported, and most processes that import one never
     * write a line. Opening a file for each of those is what filled the folder with empty ones.
     */
    test('is not made until something is asked of it', async () => {
        const {getLogger, getLoopLogger} = await loadLogger();
        const logger = getLogger('mcp-service');
        getLoopLogger('agent.a1');
        expect(mocks.root).not.toHaveBeenCalled();
        expect(mocks.enforceFileCountLimit).not.toHaveBeenCalled();
        logger.info('at last');
        expect(mocks.root).toHaveBeenCalledOnce();
    });

    /** The name says when the first line was written, and which process wrote it. */
    test('names the file after the write that opened it and the process behind it', async () => {
        const {getLogger} = await loadLogger();
        mocks.timestamp.mockReturnValue('20260827102900000');
        getLogger('any').info('now');
        expect(destination())
            .toBe(`${WORKING_DIR}/.logs/runtime_20260827102900000_${process.pid}.log`);
    });

    /** The web server of a published build runs from its own installation, never from the home. */
    test('writes to a file under the .logs of the working dir and creates the folder when missing', async () => {
        const {getLogger} = await loadLogger();
        getLogger('any').info('now');
        const config = rootConfig();
        expect(config.transport.target).toBe('pino/file');
        expect(config.transport.options.mkdir).toBe(true);
        expect(destination()).toMatch(/\/\.logs\/runtime_\d+_\d+\.log$/);
        expect(destination().startsWith(WORKING_DIR)).toBe(true);
    });

    test('makes room for the file it is about to open', async () => {
        const {getLogger} = await loadLogger();
        getLogger('any').info('now');
        // One less than the limit, the file about to be opened being the one it makes room for.
        expect(mocks.enforceFileCountLimit).toHaveBeenCalledOnce();
        const [folder, limit] = mocks.enforceFileCountLimit.mock.calls[0]!;
        expect(folder).toBe(`${WORKING_DIR}/.logs`);
        expect(limit).toBe(MAX_LOG_FILES - 1);
    });

    describe('the log files it will not throw away', () => {

        async function keptFile(): Promise<(fileName: string) => boolean> {
            const {getLogger} = await loadLogger();
            getLogger('any').info('now');
            return mocks.enforceFileCountLimit.mock.calls[0]![2]!;
        }

        /**
         * A log deleted under the process writing it is not a log rotated: on linux the delete goes
         * through and the lines that follow go nowhere anybody can read.
         */
        test('keeps the log of a process that is still running', async () => {
            expect((await keptFile())(`runtime_20260101000000000_${process.pid}.log`)).toBe(true);
        });

        test('lets go of the log of a process that has ended', async () => {
            // Above every pid a system will hand out, so nothing can be running under it.
            expect((await keptFile())('runtime_20260101000000000_2147483646.log')).toBe(false);
        });

        test('lets go of a file whose name says nothing about a process', async () => {
            const keep = await keptFile();
            // The name a log carried before it carried a pid, and a name of ours it never was.
            expect(keep('runtime_20260101000000000.log')).toBe(false);
            expect(keep('something-else.txt')).toBe(false);
        });

        /** Whatever put this here, it is not the file this process is writing to. */
        test('lets go of a name that only begins like one of ours', async () => {
            const keep = await keptFile();
            expect(keep(`runtime_20260101000000000_${process.pid}.log.gz`)).toBe(false);
            expect(keep(`archive_20260101000000000_${process.pid}.log`)).toBe(false);
            expect(keep(`runtime_20260101000000000_0.log`)).toBe(false);
        });
    });
});

function rootConfig(): {transport: {target: string, options: {destination: string, mkdir: boolean}}} {
    return mocks.root.mock.calls[0]![0] as {
        transport: {target: string, options: {destination: string, mkdir: boolean}}
    };
}

function destination(): string {
    return rootConfig().transport.options.destination;
}
