import {beforeEach, describe, expect, test, vi, type Mock} from 'vitest';
import {
    MAX_DISPLAY_HISTORIES, type CronTask, type LLMTaskOutput, type TokenUsage
} from '@deepclaw/core';
import {
    CRON_DIR, CRON_HISTORY_DIR, CRON_HISTORY_JSONL, CRON_TASK_JSON, FILES_DIR, cronFilesDir,
    cronOutputDir
} from '../../paths';
import {HISTORY_SHARD_SIZE, HISTORY_SHARDS_KEPT, MEMORY_HISTORY_WINDOW} from './cron-service';

type LoopResult = {text: string; runtime: {usage: TokenUsage; transitionReason: string}};

type FakeJob = {cron: string; started: boolean; timeZone: string; tick: () => Promise<void>; stop: Mock};

const NEXT_RUN = '2024-05-01T03:00:00.000+02:00';
const SESSION_DIR = '.agents/a1/session/cron1';

function newUsage(value = 0): TokenUsage {
    return {cachedInputTokens: value, noCachedInputTokens: value * 2, outputTokens: value * 3};
}

/**
 * A disk of paths and their bytes, standing in for the one `FileUtils` writes to.
 *
 * The record of a task is a folder of shards now, opened, appended to and deleted as the runs come
 * in, and none of that can be told from a mock answering one fixture: what a shard holds has to be
 * what was written to it. Reads come back off this the way they would off a file.
 */
const disk = new Map<string, string>();

/** Paths a write fails for, so what a piece of work half done leaves behind can be looked at. */
const unwritable: string[] = [];

function fakeExists(path: string): boolean {
    return disk.has(path) || [...disk.keys()].some(key => key.startsWith(`${path}/`));
}

function fakeReadFile(path: string): string {
    const content = disk.get(path);
    if (content === undefined) {
        throw new Error(`File ${path} not found.`);
    }
    return content;
}

function fakeReadTailLines(path: string, count: number): string[] {
    const content = disk.get(path);
    return count <= 0 || content === undefined
        ? [] : content.split('\n').filter(Boolean).slice(-count);
}

function fakeWriteFile(path: string, content: string): string {
    if (unwritable.some(part => path.includes(part))) {
        throw new Error(`No room for ${path}`);
    }
    disk.set(path, content);
    return path;
}

function fakeAppendFile(path: string, content: string): void {
    disk.set(path, `${disk.get(path) ?? ''}${content}`);
}

function fakeDeleteFile(path: string): void {
    disk.delete(path);
}

function fakeDeleteDir(path: string): void {
    for (const key of [...disk.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) {
            disk.delete(key);
        }
    }
}

/** Newest name first, because a folder answers in no order and the service has to sort for itself. */
function fakeListFiles(path: string): string[] {
    const names = new Set<string>();
    for (const key of disk.keys()) {
        if (!key.startsWith(`${path}/`)) continue;
        const rest = key.slice(path.length + 1);
        if (!rest.includes('/')) {
            names.add(rest);
        }
    }
    return [...names].reverse();
}

function shardPath(id: string, firstStart: number): string {
    return `${CRON_DIR}/${id}/${CRON_HISTORY_DIR}/${firstStart}.jsonl`;
}

/**
 * The shards a record of these lines lies in, the way the service would have written them. A line
 * that is no run names its shard nothing, which is how a record of broken lines is put on the disk.
 */
function shardsOfLines(id: string, lines: string[]): void {
    for (let from = 0; from < lines.length; from += HISTORY_SHARD_SIZE) {
        const shard = lines.slice(from, from + HISTORY_SHARD_SIZE);
        let firstStart = 0;
        try {
            firstStart = (JSON.parse(shard[0]!) as {start: number}).start;
        } catch {
            firstStart = 0;
        }
        disk.set(shardPath(id, firstStart), `${shard.join('\n')}\n`);
    }
}

const mocks = vi.hoisted(() => ({
    jobs: [] as FakeJob[],
    isValidCron: vi.fn<(cron: string) => boolean>(() => true),
    nextRun: vi.fn<() => string | null>(() => '2024-05-01T03:00:00.000+02:00'),
    exists: vi.fn<(path: string) => boolean>(() => false),
    readDir: vi.fn<(dir: string) => Record<string, {dir: string; content: string}>>(() => ({})),
    readFile: vi.fn<(path: string) => string>(() => ''),
    readTailLines: vi.fn<(path: string, count: number) => string[]>(() => []),
    listFiles: vi.fn<(path: string) => string[]>(() => []),
    writeFile: vi.fn<(path: string, content: string) => string>((path: string) => path),
    appendFile: vi.fn<(path: string, content: string) => void>(() => undefined),
    deleteFile: vi.fn<(path: string) => void>(() => undefined),
    deleteDir: vi.fn<(path: string) => void>(() => undefined),
    hashString: vi.fn<(text: string) => string>(() => 'titlehash'),
    readBuffer: vi.fn<(path: string) => Buffer>(path => Buffer.from(`bytes of ${path}`)),
    sizeOf: vi.fn<(path: string) => number | null>(),
    isPathInWorkspace: vi.fn<(path: string) => boolean>(() => true),
    isFile: vi.fn<(path: string) => boolean>(() => true),
    getLoop: vi.fn<(...args: unknown[]) => unknown>(() => undefined),
    invoke: vi.fn<(prompt: string, options: {browserId: string}) => Promise<LoopResult>>(),
    getSessionDir: vi.fn<() => string>(() => '.agents/a1/session/cron1'),
}));

vi.mock('cron', () => ({
    CronJob: class FakeCronJob {
        public stop = vi.fn();
        public nextDate = (): {toISO: () => string | null} => ({toISO: () => mocks.nextRun()});

        constructor(...args: [string, () => Promise<void>, null, boolean, string]) {
            const [cron, tick, , started, timeZone] = args;
            if (!mocks.isValidCron(cron)) {
                throw new Error(`Invalid cron expression ${cron}`);
            }
            mocks.jobs.push({cron, tick, started, timeZone, stop: this.stop});
        }
    },
}));

vi.mock('../../loop-initializer', () => ({LoopInitializer: {getLoop: mocks.getLoop}}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => {
    const original = await importOriginal<typeof import('@deepclaw/node-utils')>();
    return {
        ...original,
        FileUtils: {
            exists: mocks.exists,
            readDir: mocks.readDir,
            readFile: mocks.readFile,
            readTailLines: mocks.readTailLines,
            listFiles: mocks.listFiles,
            writeFile: mocks.writeFile,
            appendFile: mocks.appendFile,
            deleteFile: mocks.deleteFile,
            deleteDir: mocks.deleteDir,
            hashString: mocks.hashString,
            readBuffer: mocks.readBuffer,
            sizeOf: mocks.sizeOf,
            isPathInWorkspace: mocks.isPathInWorkspace,
            isFile: mocks.isFile,
            sanitizeFileName: original.FileUtils.sanitizeFileName.bind(original.FileUtils),
            getAbsolutePath: original.FileUtils.getAbsolutePath.bind(original.FileUtils),
            isPathInside: original.FileUtils.isPathInside.bind(original.FileUtils),
        },
        getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
        getLoopLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    };
});

type CronServiceType = (typeof import('./cron-service'))['CronService'];

/** A run hands over what it made, and the folder it hands over from holds nothing of its own yet. */
function unfiled(path: string): Buffer {
    if (path.includes(`/${FILES_DIR}/`)) {
        throw new Error('ENOENT');
    }
    return Buffer.from(`bytes of ${path}`);
}

/** A file on disk has the size of the bytes it holds, and what is not there has no size. */
function sizeUnfiled(path: string): number | null {
    try {
        return unfiled(path).length;
    } catch {
        return null;
    }
}

function primeMocks(): void {
    vi.clearAllMocks();
    mocks.jobs.length = 0;
    disk.clear();
    unwritable.length = 0;
    mocks.isValidCron.mockReturnValue(true);
    mocks.nextRun.mockReturnValue(NEXT_RUN);
    mocks.exists.mockImplementation(fakeExists);
    mocks.readFile.mockImplementation(fakeReadFile);
    mocks.readTailLines.mockImplementation(fakeReadTailLines);
    mocks.listFiles.mockImplementation(fakeListFiles);
    mocks.writeFile.mockImplementation(fakeWriteFile);
    mocks.appendFile.mockImplementation(fakeAppendFile);
    mocks.deleteFile.mockImplementation(fakeDeleteFile);
    mocks.deleteDir.mockImplementation(fakeDeleteDir);
    mocks.readBuffer.mockImplementation(unfiled);
    mocks.sizeOf.mockImplementation(sizeUnfiled);
    mocks.isPathInWorkspace.mockReturnValue(true);
    mocks.isFile.mockReturnValue(true);
    mocks.getSessionDir.mockReturnValue(SESSION_DIR);
    mocks.getLoop.mockReturnValue({invoke: mocks.invoke, getSessionDir: mocks.getSessionDir});
    mocks.invoke.mockResolvedValue({text: 'result', runtime: {usage: newUsage(1), transitionReason: 'end'}});
}

/**
 * The service is a globalized singleton whose statics survive `vi.resetModules`, so the global slot
 * is dropped to give every test its own instance. Used on its own it is a restart: the disk stands
 * as the last instance left it, which is the only way to see what a start makes of what it finds.
 */
async function freshService(): Promise<CronServiceType> {
    delete (globalThis as unknown as Record<string, unknown>)['__CronService'];
    vi.resetModules();
    return (await import('./cron-service')).CronService;
}

async function loadService(
    stored: {
        files?: Record<string, {dir: string; content: string}>;
        /** The record as a sharded one lies on disk, which is how a record lies since the shards. */
        historyLines?: string;
        /** The record as one file, which is how it lay before them and what a migration finds. */
        legacyLines?: string;
        /** Paths that cannot be written while the service starts. */
        unwritable?: string[];
    } = {}
): Promise<CronServiceType> {
    primeMocks();
    unwritable.push(...stored.unwritable ?? []);
    const files = stored.files ?? {};
    mocks.readDir.mockReturnValue(files);
    for (const [id, file] of Object.entries(files)) {
        disk.set(`${CRON_DIR}/${id}/${CRON_TASK_JSON}`, file.content);
        if (stored.historyLines !== undefined) {
            shardsOfLines(id, stored.historyLines.split('\n').filter(Boolean));
        }
        if (stored.legacyLines !== undefined) {
            disk.set(`${CRON_DIR}/${id}/${CRON_HISTORY_JSONL}`, stored.legacyLines);
        }
    }
    return freshService();
}

function storedTask(overrides: Partial<CronTask> = {}): {dir: string; content: string} {
    return {
        dir: `${CRON_DIR}/t1`,
        content: JSON.stringify({
            id: 't1',
            title: 'nightly',
            creator: 'a1',
            cron: '0 0 * * *',
            prompt: 'do it',
            usage: newUsage(),
            ...overrides,
        }),
    };
}

function newTask(service: CronServiceType, cron = '0 0 * * *'): CronTask {
    return service.createCronTask('nightly', 'a1', cron, 'do it');
}

async function runTicks(starts: number[]): Promise<void> {
    const now = vi.spyOn(Date, 'now');
    for (const start of starts) {
        now.mockReturnValue(start);
        await mocks.jobs[0]!.tick();
    }
    now.mockRestore();
}

function historyLine(start: number, status = 'success'): string {
    return JSON.stringify({start, status, usage: newUsage()});
}

/** Starts a tick that stays inside the loop invocation until the returned release is called. */
async function startRun(): Promise<{release: () => void; finished: Promise<void>}> {
    let release = (): void => undefined;
    mocks.invoke.mockImplementation(() => new Promise<LoopResult>(resolve => {
        release = () => resolve({text: 'result', runtime: {usage: newUsage(1), transitionReason: 'end'}});
    }));
    const finished = mocks.jobs[0]!.tick();
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalled());
    return {release: () => release(), finished};
}

describe('loadCronTasks', () => {

    test('loads nothing when the cron folder does not exist', async () => {
        const service = await loadService();
        expect(service.getCronTasks()).toEqual([]);
        expect(mocks.readDir).not.toHaveBeenCalled();
    });

    test('schedules a stored task that is neither paused nor closed', async () => {
        const service = await loadService({files: {t1: storedTask()}, historyLines: historyLine(1000)});
        expect(service.getCronTaskDetail('t1').prompt).toBe('do it');
        expect(mocks.jobs).toHaveLength(1);
        expect(mocks.jobs[0]!.cron).toBe('0 0 * * *');
    });

    test('keeps a paused task without scheduling it', async () => {
        const service = await loadService({
            files: {t1: storedTask({paused: true})}, historyLines: historyLine(1000),
        });
        expect(service.getCronTaskDetail('t1').paused).toBe(true);
        expect(mocks.jobs).toHaveLength(0);
    });

    test('forgets a closed task completely', async () => {
        const service = await loadService({files: {t1: storedTask({closed: true})}});
        expect(service.getCronTasks()).toEqual([]);
    });

    test('restores the histories from the shards of the record', async () => {
        const service = await loadService({
            files: {t1: storedTask()}, historyLines: `${historyLine(1000)}\n${historyLine(2000)}\n`,
        });
        expect(service.getCronTaskDetail('t1').histories.map(history => history.start)).toEqual([1000, 2000]);
        expect(mocks.readTailLines).toHaveBeenCalledWith(shardPath('t1', 1000), MEMORY_HISTORY_WINDOW);
    });

    test('reads only the end of a record too long to hold', async () => {
        // The whole point: a task on a five minute schedule writes a hundred thousand runs a year,
        // and a startup that read all of them to keep the last forty is the thing being fixed.
        const lines = Array.from({length: MEMORY_HISTORY_WINDOW + 10}, (_, i) => historyLine(i + 1));
        const service = await loadService({
            files: {t1: storedTask()}, historyLines: `${lines.join('\n')}\n`,
        });
        const starts = service.getCronTaskDetail('t1').histories.map(history => history.start);
        expect(starts).toHaveLength(MAX_DISPLAY_HISTORIES);
        expect(starts[starts.length - 1]).toBe(MEMORY_HISTORY_WINDOW + 10);
        expect(mocks.readFile)
            .not.toHaveBeenCalledWith(`${CRON_DIR}/t1/${CRON_HISTORY_JSONL}`);
    });

    test('passes over a half written line and keeps the runs on either side of it', async () => {
        // A process killed mid append leaves half a line, and reading the window as one thing means
        // that half line takes the whole window with it.
        const service = await loadService({
            files: {t1: storedTask()},
            historyLines: `${historyLine(1000)}\n{"start":2000,"sta\n${historyLine(3000)}\n`,
        });
        expect(service.getCronTaskDetail('t1').histories.map(history => history.start))
            .toEqual([1000, 3000]);
    });

    test('starts with an empty window when no line of the record is a run', async () => {
        const service = await loadService({files: {t1: storedTask()}, historyLines: 'not json'});
        expect(service.getCronTaskDetail('t1').histories).toEqual([]);
    });

    test('starts a task that never ran with an empty history', async () => {
        const service = await loadService({files: {t1: storedTask()}});
        expect(service.getCronTaskDetail('t1').histories).toEqual([]);
        expect(service.getCronHistories('t1', Number.MAX_SAFE_INTEGER)).toEqual([]);
    });

    test('records the first run of a task that was restored without a history file', async () => {
        const service = await loadService({files: {t1: storedTask()}});
        await runTicks([1000]);
        expect(service.getCronTaskDetail('t1').histories).toHaveLength(1);
    });

    test('skips a task file that is not valid json', async () => {
        const service = await loadService({files: {t1: {dir: `${CRON_DIR}/t1`, content: '{broken'}}});
        expect(service.getCronTasks()).toEqual([]);
    });

    test('does not read the folder again once tasks are in memory', async () => {
        const service = await loadService({files: {t1: storedTask()}, historyLines: historyLine(1000)});
        mocks.readDir.mockClear();
        service.loadCronTasks();
        expect(mocks.readDir).not.toHaveBeenCalled();
    });
});

describe('createCronTask', () => {

    let service: CronServiceType;

    beforeEach(async () => {
        service = await loadService();
    });

    test('stores the task with a generated id, zeroed usage and no history', () => {
        const task = newTask(service);
        expect(task.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(task.title).toBe('nightly');
        expect(task.creator).toBe('a1');
        expect(task.usage).toEqual(newUsage());
        expect(task.histories).toEqual([]);
        expect(service.getCronTaskDetail(task.id).prompt).toBe('do it');
    });

    test('starts the job for the given expression in the local time zone', () => {
        newTask(service, '*/5 * * * *');
        expect(mocks.jobs).toHaveLength(1);
        expect(mocks.jobs[0]!.cron).toBe('*/5 * * * *');
        expect(mocks.jobs[0]!.started).toBe(true);
        expect(mocks.jobs[0]!.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    });

    test('takes the next run from the scheduled job', () => {
        expect(newTask(service).nextRun).toBe(NEXT_RUN);
    });

    test('falls back to an empty next run when the job has no next date', () => {
        mocks.nextRun.mockReturnValue(null);
        expect(newTask(service).nextRun).toBe('');
    });

    test('persists the task without its histories and next run', () => {
        const task = newTask(service);
        expect(mocks.writeFile).toHaveBeenCalledOnce();
        const [path, content] = mocks.writeFile.mock.calls[0]!;
        expect(path).toBe(`${CRON_DIR}/${task.id}/${CRON_TASK_JSON}`);
        expect(JSON.parse(content)).toEqual({
            id: task.id, title: 'nightly', creator: 'a1', cron: '0 0 * * *', prompt: 'do it', usage: newUsage(),
        });
    });

    test('survives a failing write', () => {
        mocks.writeFile.mockImplementation(() => {
            throw new Error('disk full');
        });
        expect(newTask(service).title).toBe('nightly');
    });

    test('announces the next run and then the whole task to subscribers', () => {
        const updates: {id: string}[] = [];
        const unsubscribe = service.subscribe(update => updates.push(update));
        const task = newTask(service);
        unsubscribe();
        expect(updates).toHaveLength(2);
        expect(updates[0]).toEqual({id: task.id, nextRun: NEXT_RUN});
        expect(updates[1]).toMatchObject({id: task.id, title: 'nightly', prompt: 'do it'});
    });

    test('forgets a task whose expression cannot be scheduled', () => {
        mocks.isValidCron.mockReturnValue(false);
        expect(() => newTask(service, 'not a cron')).toThrow('Invalid cron expression not a cron');
        expect(service.getCronTasks()).toEqual([]);
        expect(mocks.deleteDir).toHaveBeenCalledOnce();
        expect(mocks.deleteDir.mock.calls[0]![0]).toMatch(new RegExp(`^${CRON_DIR}/`));
    });

    test('does not announce a task that could not be scheduled', () => {
        const updates: {id: string}[] = [];
        service.subscribe(task => updates.push(task as {id: string}));
        mocks.isValidCron.mockReturnValue(false);
        expect(() => newTask(service, 'not a cron')).toThrow('Invalid cron expression not a cron');
        expect(updates).toEqual([]);
    });
});

describe('updateCronTask', () => {

    let service: CronServiceType;

    beforeEach(async () => {
        service = await loadService();
    });

    test('applies the new title, cron and prompt', () => {
        const {id} = newTask(service);
        const updated = service.updateCronTask({id, title: 'weekly', cron: '0 0 * * 0', prompt: 'other'});
        expect(updated).toMatchObject({title: 'weekly', cron: '0 0 * * 0', prompt: 'other'});
        expect(service.getCronTaskDetail(id).title).toBe('weekly');
    });

    test('ignores empty values', () => {
        const {id} = newTask(service);
        expect(service.updateCronTask({id, title: '', prompt: 'other'}).title).toBe('nightly');
    });

    test('stops the old job and schedules a new one when the cron changed', () => {
        const {id} = newTask(service);
        const first = mocks.jobs[0]!;
        service.updateCronTask({id, cron: '0 1 * * *'});
        expect(first.stop).toHaveBeenCalledOnce();
        expect(mocks.jobs).toHaveLength(2);
        expect(mocks.jobs[1]!.cron).toBe('0 1 * * *');
    });

    test('reschedules on a new prompt as well', () => {
        const {id} = newTask(service);
        service.updateCronTask({id, prompt: 'other'});
        expect(mocks.jobs).toHaveLength(2);
    });

    test('keeps the running job when only the title changed', () => {
        const {id} = newTask(service);
        service.updateCronTask({id, title: 'weekly'});
        expect(mocks.jobs).toHaveLength(1);
        expect(mocks.jobs[0]!.stop).not.toHaveBeenCalled();
    });

    test('leaves a paused task unscheduled', () => {
        const {id} = newTask(service);
        service.updateCronTaskStatus({id, pause: true});
        service.updateCronTask({id, cron: '0 1 * * *'});
        expect(mocks.jobs).toHaveLength(1);
    });

    test('persists and announces the new values', () => {
        const {id} = newTask(service);
        const updates: {id: string}[] = [];
        const unsubscribe = service.subscribe(update => updates.push(update));
        service.updateCronTask({id, title: 'weekly'});
        unsubscribe();
        expect(updates).toEqual([{id, title: 'weekly', cron: '0 0 * * *', prompt: 'do it'}]);
        expect(mocks.writeFile).toHaveBeenCalledTimes(2);
    });

    test('throws for an unknown id', () => {
        expect(() => service.updateCronTask({id: 'ghost'})).toThrow('Cron task not found.');
    });

    test('reports a closed task as missing because closing forgets it', () => {
        const {id} = newTask(service);
        service.updateCronTaskStatus({id, close: true});
        expect(() => service.updateCronTask({id, title: 'weekly'})).toThrow('Cron task not found.');
    });
});

describe('updateCronTaskStatus', () => {

    let service: CronServiceType;

    beforeEach(async () => {
        service = await loadService();
    });

    test('pauses the task, stops the job and clears the next run', () => {
        const {id} = newTask(service);
        service.updateCronTaskStatus({id, pause: true});
        expect(mocks.jobs[0]!.stop).toHaveBeenCalledOnce();
        const task = service.getCronTaskDetail(id);
        expect(task.paused).toBe(true);
        expect(task.nextRun).toBeUndefined();
    });

    test('schedules the task again when it is resumed', () => {
        const {id} = newTask(service);
        service.updateCronTaskStatus({id, pause: true});
        service.updateCronTaskStatus({id, pause: false});
        expect(mocks.jobs).toHaveLength(2);
        expect(service.getCronTaskDetail(id).nextRun).toBe(NEXT_RUN);
    });

    test('does not schedule a second job for a task that still runs', () => {
        const {id} = newTask(service);
        service.updateCronTaskStatus({id, pause: false});
        expect(mocks.jobs).toHaveLength(1);
    });

    test('closes the task, stops the job and forgets it', () => {
        const {id} = newTask(service);
        service.updateCronTaskStatus({id, close: true});
        expect(mocks.jobs[0]!.stop).toHaveBeenCalledOnce();
        expect(service.getCronTasks()).toEqual([]);
        expect(() => service.getCronTaskDetail(id)).toThrow('Cron task not found.');
    });

    test('sends null instead of undefined to subscribers', () => {
        const {id} = newTask(service);
        const updates: {id: string}[] = [];
        const unsubscribe = service.subscribe(update => updates.push(update));
        service.updateCronTaskStatus({id, pause: true});
        unsubscribe();
        expect(updates).toEqual([{id, paused: true, closed: null, nextRun: null}]);
    });

    test('persists the closed task one last time', () => {
        const {id} = newTask(service);
        mocks.writeFile.mockClear();
        service.updateCronTaskStatus({id, close: true});
        const [, content] = mocks.writeFile.mock.calls[0]!;
        expect(JSON.parse(content)).toMatchObject({closed: true, paused: true});
    });

    test('throws for an unknown id', () => {
        expect(() => service.updateCronTaskStatus({id: 'ghost', pause: true})).toThrow('Cron task not found.');
    });
});

describe('scheduled run', () => {

    let service: CronServiceType;

    beforeEach(async () => {
        service = await loadService();
    });

    test('runs the prompt in a cron loop of the creator', async () => {
        const {id} = newTask(service);
        await runTicks([1000]);
        expect(mocks.getLoop).toHaveBeenCalledWith('cron', 'a1', id, expect.anything());
        expect(mocks.invoke).toHaveBeenCalledWith('do it', {browserId: ''});
    });

    test('records a successful run with its final text and usage', async () => {
        const {id} = newTask(service);
        await runTicks([1000]);
        const [history] = service.getCronTaskDetail(id).histories;
        expect(history).toMatchObject({
            start: 1000, completed: 1000, status: 'success', finalText: 'result', usage: newUsage(1),
        });
        expect(service.getCronTaskDetail(id).lastRun).toBe(new Date(1000).toISOString());
    });

    test('marks the run failed when the loop reports an error transition', async () => {
        const {id} = newTask(service);
        mocks.invoke.mockResolvedValue({text: 'broken', runtime: {usage: newUsage(1), transitionReason: 'error'}});
        await runTicks([1000]);
        expect(service.getCronTaskDetail(id).histories[0]).toMatchObject({status: 'failed', usage: newUsage(1)});
    });

    test('marks the run failed when the loop throws', async () => {
        const {id} = newTask(service);
        mocks.invoke.mockRejectedValue(new Error('loop exploded'));
        await runTicks([1000]);
        const [history] = service.getCronTaskDetail(id).histories;
        expect(history!.status).toBe('failed');
        expect(history!.finalText).toContain('Failed to run cron task');
        expect(history!.usage).toEqual(newUsage());
    });

    test('accumulates the usage of every run on the task', async () => {
        const {id} = newTask(service);
        await runTicks([1000, 2000]);
        expect(service.getCronTaskDetail(id).usage).toEqual(newUsage(2));
    });

    test('appends the history to the jsonl file and drops the session folder', async () => {
        const {id} = newTask(service);
        await runTicks([1000]);
        expect(mocks.appendFile).toHaveBeenCalledOnce();
        const [path, line] = mocks.appendFile.mock.calls[0]!;
        expect(path).toBe(shardPath(id, 1000));
        expect(JSON.parse(line)).toMatchObject({start: 1000, status: 'success'});
        expect(line.endsWith('\n')).toBe(true);
        expect(mocks.deleteDir).toHaveBeenCalledWith(SESSION_DIR);
    });

    test('keeps running further ticks when persisting the history fails', async () => {
        const {id} = newTask(service);
        mocks.appendFile.mockImplementation(() => {
            throw new Error('disk full');
        });
        await runTicks([1000, 2000]);
        expect(service.getCronTaskDetail(id).histories).toHaveLength(2);
    });

    test('refreshes the next run before the prompt is invoked', async () => {
        const {id} = newTask(service);
        mocks.nextRun.mockReturnValue('2024-06-01T03:00:00.000+02:00');
        await runTicks([1000]);
        expect(service.getCronTaskDetail(id).nextRun).toBe('2024-06-01T03:00:00.000+02:00');
    });

    test('announces the start and the completion of a run', async () => {
        const {id} = newTask(service);
        const updates: {id: string}[] = [];
        const unsubscribe = service.subscribe(update => updates.push(update));
        await runTicks([1000]);
        unsubscribe();
        expect(updates).toHaveLength(2);
        expect(updates[0]).toMatchObject({id, lastRun: new Date(1000).toISOString(), nextRun: NEXT_RUN});
        expect(updates[1]).toMatchObject({id, usage: newUsage(1)});
    });

    test('skips a tick while the previous run is still going', async () => {
        const {id} = newTask(service);
        const {release, finished} = await startRun();
        await mocks.jobs[0]!.tick();
        expect(mocks.invoke).toHaveBeenCalledOnce();
        release();
        await finished;
        expect(service.getCronTaskDetail(id).histories).toHaveLength(1);
    });

    test('runs again once the previous run finished', async () => {
        const {id} = newTask(service);
        await runTicks([1000]);
        await runTicks([2000]);
        expect(service.getCronTaskDetail(id).histories).toHaveLength(2);
    });

    test('ignores a tick of a job that is gone', async () => {
        const {id} = newTask(service);
        const {tick} = mocks.jobs[0]!;
        service.updateCronTaskStatus({id, pause: true});
        await tick();
        expect(mocks.invoke).not.toHaveBeenCalled();
    });
});

describe('updateCronOutput', () => {

    let service: CronServiceType;

    beforeEach(async () => {
        service = await loadService();
    });

    test('attaches the output to the history of the running job', async () => {
        const {id} = newTask(service);
        const {release, finished} = await startRun();
        service.updateCronOutput(id, {type: 'text', content: 'the answer'});
        release();
        await finished;
        expect(service.getCronTaskDetail(id).histories[0]!.output).toEqual({type: 'text', content: 'the answer'});
    });

    test('keeps a short output on the history rather than in a file', async () => {
        const {id} = newTask(service);
        const {release, finished} = await startRun();
        mocks.writeFile.mockClear();
        service.updateCronOutput(id, {type: 'text', content: 'the answer'});
        release();
        await finished;
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    test('files a long output away under the folder of the task', async () => {
        const {id} = newTask(service);
        const {release, finished} = await startRun();
        mocks.writeFile.mockClear();
        const output: LLMTaskOutput = {type: 'markdown', content: '#'.repeat(1501)};
        service.updateCronOutput(id, output);
        release();
        await finished;
        expect(mocks.writeFile).toHaveBeenCalledWith(
            expect.stringMatching(new RegExp(`^${cronOutputDir(id)}/\\d+\\.md$`)), '#'.repeat(1501)
        );
        expect(output.path).toMatch(new RegExp(`^/api/file/cron/${id}/output/\\d+\\.md$`));
    });

    /** A scheduled run hands its files over the way a task does, only nobody is there to see it. */
    test('hands the files of the run over from the folder of the task', async () => {
        const {id} = newTask(service);
        const {release, finished} = await startRun();
        const output = {type: 'markdown' as const, content: '# digest'};
        expect(service.updateCronOutput(id, output, ['out/digest.csv'])).toEqual({skipped: []});
        release();
        await finished;
        expect(mocks.writeFile).toHaveBeenCalledWith(
            `${cronFilesDir(id)}/digest.csv`, Buffer.from('bytes of out/digest.csv')
        );
        expect(output.content).toContain(`- [digest.csv](/api/file/cron/${id}/files/digest.csv)`);
    });

    test('reports a file it could not hand over', async () => {
        const {id} = newTask(service);
        const {release, finished} = await startRun();
        mocks.isPathInWorkspace.mockReturnValue(false);
        expect(service.updateCronOutput(id, {type: 'markdown', content: '# digest'}, ['/tmp/x.pdf']))
            .toEqual({skipped: ['/tmp/x.pdf']});
        release();
        await finished;
    });

    test('throws when the task never ran', () => {
        const {id} = newTask(service);
        expect(() => service.updateCronOutput(id, {type: 'text', content: 'x'}))
            .toThrow('No history found for cron task.');
    });

    test('throws once the last run completed', async () => {
        const {id} = newTask(service);
        await runTicks([1000]);
        expect(() => service.updateCronOutput(id, {type: 'text', content: 'x'}))
            .toThrow('Cron task already completed.');
    });

    test('throws for an unknown task', () => {
        expect(() => service.updateCronOutput('ghost', {type: 'text', content: 'x'}))
            .toThrow('Cron task not found.');
    });
});

describe('getCronTasks and getCronTaskDetail', () => {

    let service: CronServiceType;

    beforeEach(async () => {
        service = await loadService();
    });

    test('lists every open task', () => {
        const first = newTask(service);
        const second = service.createCronTask('weekly', 'a2', '0 0 * * 0', 'other');
        expect(service.getCronTasks().map(task => task.id)).toEqual([first.id, second.id]);
    });

    test('caps the histories of a listed task to the display limit', async () => {
        newTask(service);
        await runTicks([...Array(MAX_DISPLAY_HISTORIES + 2).keys()].map(index => (index + 1) * 1000));
        const [task] = service.getCronTasks();
        expect(task!.histories).toHaveLength(MAX_DISPLAY_HISTORIES);
        expect(task!.histories[0]!.start).toBe(3000);
    });

    test('leaves the stored histories untouched when capping the detail', async () => {
        const {id} = newTask(service);
        await runTicks([1000, 2000]);
        service.getCronTaskDetail(id);
        expect(service.getCronHistories(id, Number.MAX_SAFE_INTEGER)).toHaveLength(2);
    });

    test('throws for an unknown id', () => {
        expect(() => service.getCronTaskDetail('ghost')).toThrow('Cron task not found.');
    });
});

describe('getCronHistories', () => {

    let service: CronServiceType;
    let taskId: string;

    beforeEach(async () => {
        service = await loadService();
        taskId = newTask(service).id;
        await runTicks([1000, 2000, 3000, 4000, 5000]);
    });

    test('returns the newest histories first', () => {
        expect(service.getCronHistories(taskId, Number.MAX_SAFE_INTEGER, 2).map(history => history.start))
            .toEqual([5000, 4000]);
    });

    test('stops right before the cursor', () => {
        expect(service.getCronHistories(taskId, 4000, 2).map(history => history.start)).toEqual([3000, 2000]);
    });

    test('returns nothing when the cursor is the oldest history', () => {
        expect(service.getCronHistories(taskId, 1000, 2)).toEqual([]);
    });

    test('returns fewer entries than asked for when the page is not full', () => {
        expect(service.getCronHistories(taskId, 2000, 5).map(history => history.start)).toEqual([1000]);
    });

    test('defaults the page size to the display limit', async () => {
        await runTicks([...Array(MAX_DISPLAY_HISTORIES).keys()].map(index => (index + 6) * 1000));
        expect(service.getCronHistories(taskId, Number.MAX_SAFE_INTEGER)).toHaveLength(MAX_DISPLAY_HISTORIES);
    });

    test('throws for an unknown task', () => {
        expect(() => service.getCronHistories('ghost', 1000)).toThrow('Cron task not found.');
    });
});

describe('the memory history window', () => {

    const STORED = MEMORY_HISTORY_WINDOW + 10;

    /** A task whose record is longer than memory keeps, its runs starting at 1 through to the last. */
    function longRecord(count = STORED): string {
        return `${Array.from({length: count}, (_, index) => historyLine(index + 1)).join('\n')}\n`;
    }

    test('answers the first page without reading the disk', async () => {
        const service = await loadService({files: {t1: storedTask()}, historyLines: longRecord()});
        const page = service.getCronHistories('t1', Number.MAX_SAFE_INTEGER, MAX_DISPLAY_HISTORIES);
        expect(page.map(history => history.start)).toEqual(
            Array.from({length: MAX_DISPLAY_HISTORIES}, (_, index) => STORED - index)
        );
        expect(mocks.readTailLines).not.toHaveBeenCalledWith(shardPath('t1', 1), HISTORY_SHARD_SIZE);
    });

    test('reads the disk for a page that fell out of the window', async () => {
        const service = await loadService({files: {t1: storedTask()}, historyLines: longRecord()});
        // Eleven is the oldest run memory has, so everything this asks for is only on disk.
        expect(service.getCronHistories('t1', 11, 5).map(history => history.start))
            .toEqual([10, 9, 8, 7, 6]);
        expect(mocks.readTailLines).toHaveBeenCalledWith(shardPath('t1', 1), HISTORY_SHARD_SIZE);
    });

    test('pages back across the edge of the window', async () => {
        const service = await loadService({files: {t1: storedTask()}, historyLines: longRecord()});
        expect(service.getCronHistories('t1', 13, 4).map(history => history.start))
            .toEqual([12, 11, 10, 9]);
    });

    test('reaches the very first run without losing it', async () => {
        const service = await loadService({files: {t1: storedTask()}, historyLines: longRecord()});
        expect(service.getCronHistories('t1', 2, 5).map(history => history.start)).toEqual([1]);
        expect(service.getCronHistories('t1', 1, 5)).toEqual([]);
    });

    test('still answers with the run the disk has not got yet', async () => {
        // A run reaches the file when it completes, so the newest one lives only in memory. A
        // fallback that trusted the disk alone would answer a first run with nothing at all.
        const service = await loadService({
            files: {t1: storedTask()}, historyLines: `${historyLine(1000)}\n${historyLine(2000)}\n`,
        });
        await runTicks([3000]);
        expect(service.getCronHistories('t1', Number.MAX_SAFE_INTEGER, MAX_DISPLAY_HISTORIES)
            .map(history => history.start)).toEqual([3000, 2000, 1000]);
    });

    test('holds no more than the window however long the process runs', async () => {
        // Without trimming on the way in, a process left running would hold every run again and the
        // window would have moved the problem to startup rather than solved it. Where the edge lies
        // is read off which page the disk is asked for: exactly the window comes out of memory, one
        // run more than the window does not.
        const service = await loadService({files: {t1: storedTask()}});
        await runTicks(Array.from({length: MEMORY_HISTORY_WINDOW + 5}, (_, index) => (index + 1) * 1000));
        expect(mocks.appendFile).toHaveBeenCalledTimes(MEMORY_HISTORY_WINDOW + 5);

        mocks.readTailLines.mockClear();
        expect(service.getCronHistories('t1', Number.MAX_SAFE_INTEGER, MEMORY_HISTORY_WINDOW))
            .toHaveLength(MEMORY_HISTORY_WINDOW);
        expect(mocks.readTailLines).not.toHaveBeenCalled();

        expect(service.getCronHistories('t1', Number.MAX_SAFE_INTEGER, MEMORY_HISTORY_WINDOW + 1))
            .toHaveLength(MEMORY_HISTORY_WINDOW + 1);
        expect(mocks.readTailLines).toHaveBeenCalled();
    });

    test('files the output of the run in flight after the window has moved', async () => {
        // Trimming takes the front of the array, and the run in flight is the last of it, which is
        // where `updateCronOutput` reaches for it.
        const service = await loadService({files: {t1: storedTask()}, historyLines: longRecord()});
        const {release, finished} = await startRun();
        service.updateCronOutput('t1', {type: 'text', content: 'the answer'});
        release();
        await finished;
        const histories = service.getCronTaskDetail('t1').histories;
        expect(histories[histories.length - 1]!.output).toEqual({type: 'text', content: 'the answer'});
    });
});

describe('the shards of the record', () => {

    /** The runs of a record that is `count` long, the first starting at 1. */
    function runs(count: number): string[] {
        return Array.from({length: count}, (_, index) => historyLine(index + 1));
    }

    function shardNames(id = 't1'): number[] {
        return fakeListFiles(`${CRON_DIR}/${id}/${CRON_HISTORY_DIR}`)
            .map(name => Number.parseInt(name, 10)).sort((one, other) => one - other);
    }

    function linesOf(id: string, firstStart: number): string[] {
        return (disk.get(shardPath(id, firstStart)) ?? '').split('\n').filter(Boolean);
    }

    /** Walks the whole record back a page at a time, the way a caller with a cursor does. */
    function pageBack(service: CronServiceType, id: string, size: number): number[] {
        const walked: number[] = [];
        let before = Number.MAX_SAFE_INTEGER;
        for (;;) {
            const page = service.getCronHistories(id, before, size);
            if (!page.length) return walked;
            walked.push(...page.map(history => history.start));
            before = page[page.length - 1]!.start;
        }
    }

    test('opens a new shard once the one being written is full', async () => {
        const service = await loadService({files: {t1: storedTask()}});
        await runTicks(Array.from({length: HISTORY_SHARD_SIZE + 2}, (_, index) => index + 1));
        expect(shardNames()).toEqual([1, HISTORY_SHARD_SIZE + 1]);
        expect(linesOf('t1', 1)).toHaveLength(HISTORY_SHARD_SIZE);
        expect(linesOf('t1', HISTORY_SHARD_SIZE + 1)).toHaveLength(2);
        expect(service.getCronHistories('t1', Number.MAX_SAFE_INTEGER, 1)[0]!.start)
            .toBe(HISTORY_SHARD_SIZE + 2);
    });

    test('goes on writing the shard a restart found half full', async () => {
        const service = await loadService({files: {t1: storedTask()}, historyLines: `${runs(5).join('\n')}\n`});
        await runTicks([6]);
        expect(shardNames()).toEqual([1]);
        expect(linesOf('t1', 1)).toHaveLength(6);
        expect(service.getCronHistories('t1', Number.MAX_SAFE_INTEGER, 10).map(h => h.start))
            .toEqual([6, 5, 4, 3, 2, 1]);
    });

    test('opens a shard of its own when a restart found a full one', async () => {
        const service = await loadService({
            files: {t1: storedTask()}, historyLines: `${runs(HISTORY_SHARD_SIZE).join('\n')}\n`,
        });
        await runTicks([HISTORY_SHARD_SIZE + 1]);
        expect(shardNames()).toEqual([1, HISTORY_SHARD_SIZE + 1]);
        expect(service.getCronHistories('t1', Number.MAX_SAFE_INTEGER, 1)[0]!.start)
            .toBe(HISTORY_SHARD_SIZE + 1);
    });

    test('pages across a shard boundary without a run twice or a run missed', async () => {
        const total = HISTORY_SHARD_SIZE + 50;
        const service = await loadService({
            files: {t1: storedTask()}, historyLines: `${runs(total).join('\n')}\n`,
        });
        expect(shardNames()).toEqual([1, HISTORY_SHARD_SIZE + 1]);
        // Every run of the record, once, newest first: pages of twenty land inside a shard, on the
        // boundary and across it, and the walk has to read the same either way.
        expect(pageBack(service, 't1', MAX_DISPLAY_HISTORIES))
            .toEqual(Array.from({length: total}, (_, index) => total - index));
    });

    test('opens only the shards a page can lie in', async () => {
        const service = await loadService({
            files: {t1: storedTask()}, historyLines: `${runs(HISTORY_SHARD_SIZE * 3).join('\n')}\n`,
        });
        mocks.readTailLines.mockClear();
        // A shard named at or after the moment asked about holds nothing before it, and a page that
        // fills from one shard never reaches the ones older than it. The newest shard is opened once
        // for both the run it ends on and the runs the page is filled from.
        service.getCronHistories('t1', HISTORY_SHARD_SIZE * 2 + 51, 5);
        expect(mocks.readTailLines.mock.calls.map(([path]) => path))
            .toEqual([shardPath('t1', HISTORY_SHARD_SIZE * 2 + 1)]);
    });

    test('never reads a shard whole, however long the file behind it turns out to be', async () => {
        const service = await loadService({
            files: {t1: storedTask()}, historyLines: `${runs(HISTORY_SHARD_SIZE * 2).join('\n')}\n`,
        });
        service.getCronHistories('t1', 5, 3);
        expect(mocks.readFile).not.toHaveBeenCalledWith(expect.stringContaining(CRON_HISTORY_DIR));
        for (const [, count] of mocks.readTailLines.mock.calls) {
            expect(count).toBeLessThanOrEqual(HISTORY_SHARD_SIZE);
        }
    });

    test('drops the oldest shard once there are more than are kept', async () => {
        const full = HISTORY_SHARD_SIZE * HISTORY_SHARDS_KEPT;
        const service = await loadService({
            files: {t1: storedTask()}, historyLines: `${runs(full).join('\n')}\n`,
        });
        expect(shardNames()).toHaveLength(HISTORY_SHARDS_KEPT);
        await runTicks([full + 1]);
        const kept = shardNames();
        expect(kept).toHaveLength(HISTORY_SHARDS_KEPT);
        // The oldest went whole, and with it the runs that were only in it.
        expect(kept[0]).toBe(HISTORY_SHARD_SIZE + 1);
        expect(kept[kept.length - 1]).toBe(full + 1);
        expect(service.getCronHistories('t1', 2, 5)).toEqual([]);
        expect(service.getCronHistories('t1', Number.MAX_SAFE_INTEGER, 1)[0]!.start).toBe(full + 1);
    });

    test('records the run when retention cannot delete what it wanted to', async () => {
        const full = HISTORY_SHARD_SIZE * HISTORY_SHARDS_KEPT;
        const service = await loadService({
            files: {t1: storedTask()}, historyLines: `${runs(full).join('\n')}\n`,
        });
        mocks.deleteFile.mockImplementation(() => {
            throw new Error('No room');
        });
        await runTicks([full + 1]);
        // The append went through before retention was asked for anything, so the run is recorded
        // and the folder the run worked in still goes. Only the shard that was to be thrown away
        // stays, which costs disk and nothing else.
        expect(service.getCronHistories('t1', Number.MAX_SAFE_INTEGER, 1)[0]!.start).toBe(full + 1);
        expect(mocks.deleteDir).toHaveBeenCalledWith(SESSION_DIR);
        expect(shardNames()).toHaveLength(HISTORY_SHARDS_KEPT + 1);
    });

    test('answers a page without a run twice when the newest shard cannot be read at all', async () => {
        // The window reaches back into the shard before the newest one, so the runs of the overlap
        // are in memory and on disk both. Whatever the disk says of where it ends -- and a shard
        // that cannot be read says nothing -- neither copy may reach the page twice.
        const total = HISTORY_SHARD_SIZE + 10;
        const service = await loadService({
            files: {t1: storedTask()}, historyLines: `${runs(total).join('\n')}\n`,
        });
        const newest = shardPath('t1', HISTORY_SHARD_SIZE + 1);
        mocks.readTailLines.mockImplementation((path, count) => {
            if (path === newest) {
                throw new Error('No room');
            }
            return fakeReadTailLines(path, count);
        });
        const starts = service.getCronHistories('t1', total, MEMORY_HISTORY_WINDOW)
            .map(history => history.start);
        expect(starts).toHaveLength(MEMORY_HISTORY_WINDOW);
        expect(new Set(starts).size).toBe(starts.length);
        expect(starts).toEqual([...starts].sort((one, other) => other - one));
    });

    test('answers a page without a run twice when the last line on disk is half written', async () => {
        // The last line is the one an interrupted append leaves broken. Reading it as "the disk has
        // nothing" would let every run in memory into the page and then read the same runs out of
        // the shard behind them.
        const lines = runs(HISTORY_SHARD_SIZE + 50);
        lines[lines.length - 1] = '{"start":250,"sta';
        const service = await loadService({
            files: {t1: storedTask()}, historyLines: `${lines.join('\n')}\n`,
        });
        expect(service.getCronHistories('t1', 215, 5).map(history => history.start))
            .toEqual([214, 213, 212, 211, 210]);
    });
});

describe('migrating a record kept as one file', () => {

    function runs(count: number, from = 1): string[] {
        return Array.from({length: count}, (_, index) => historyLine(index + from));
    }

    function shardNames(id = 't1'): number[] {
        return fakeListFiles(`${CRON_DIR}/${id}/${CRON_HISTORY_DIR}`)
            .map(name => Number.parseInt(name, 10)).sort((one, other) => one - other);
    }

    test('shards the file and takes it away', async () => {
        const total = HISTORY_SHARD_SIZE + 50;
        const service = await loadService({
            files: {t1: storedTask()}, legacyLines: `${runs(total).join('\n')}\n`,
        });
        // Counted from the newest run back, so the shard that is not full is the oldest one, which
        // is the one retention takes first.
        expect(shardNames()).toEqual([1, 51]);
        expect(disk.has(`${CRON_DIR}/t1/${CRON_HISTORY_JSONL}`)).toBe(false);
        expect(service.getCronHistories('t1', Number.MAX_SAFE_INTEGER, 3).map(h => h.start))
            .toEqual([total, total - 1, total - 2]);
        expect(service.getCronHistories('t1', 2, 3).map(h => h.start)).toEqual([1]);
    });

    test('carries over only the runs that would have been kept', async () => {
        // What lies before the last five thousand the next shard opening would delete anyway, and
        // reading it to delete it is what a record grown to gigabytes cannot afford.
        const kept = HISTORY_SHARD_SIZE * HISTORY_SHARDS_KEPT;
        const service = await loadService({
            files: {t1: storedTask()}, legacyLines: `${runs(kept + 50).join('\n')}\n`,
        });
        expect(shardNames()).toHaveLength(HISTORY_SHARDS_KEPT);
        expect(shardNames()[0]).toBe(51);
        expect(service.getCronHistories('t1', 51, 5)).toEqual([]);
        expect(service.getCronHistories('t1', Number.MAX_SAFE_INTEGER, 1)[0]!.start).toBe(kept + 50);
    });

    test('leaves the file where it is when the work fails, and reads the record off it', async () => {
        // The file goes last, so a failure anywhere before it destroys nothing: the record is read
        // off the file exactly as it was before the shards existed.
        const service = await loadService({
            files: {t1: storedTask()},
            legacyLines: `${runs(30).join('\n')}\n`,
            unwritable: [CRON_HISTORY_DIR],
        });
        expect(shardNames()).toEqual([]);
        expect(disk.has(`${CRON_DIR}/t1/${CRON_HISTORY_JSONL}`)).toBe(true);
        expect(service.getCronHistories('t1', Number.MAX_SAFE_INTEGER, 3).map(h => h.start))
            .toEqual([30, 29, 28]);
        expect(service.getCronHistories('t1', 3, 5).map(h => h.start)).toEqual([2, 1]);
    });

    test('lays the same runs under the same names when a later start tries again', async () => {
        await loadService({
            files: {t1: storedTask()},
            legacyLines: `${runs(HISTORY_SHARD_SIZE + 50).join('\n')}\n`,
            unwritable: [CRON_HISTORY_DIR],
        });
        unwritable.length = 0;
        const service = await freshService();
        expect(shardNames()).toEqual([1, 51]);
        expect(disk.has(`${CRON_DIR}/t1/${CRON_HISTORY_JSONL}`)).toBe(false);
        expect(service.getCronHistories('t1', 2, 3).map(h => h.start)).toEqual([1]);
    });

    test('shards a file left beside the runs this process wrote after a failure', async () => {
        // The folder may hold nothing but those runs, so a file beside it is sharded rather than
        // deleted: deleting it on the strength of the folder existing would throw the record away.
        const failed = await loadService({
            files: {t1: storedTask()},
            legacyLines: `${runs(30).join('\n')}\n`,
            unwritable: [CRON_HISTORY_DIR],
        });
        unwritable.length = 0;
        await runTicks([1000]);
        expect(mocks.appendFile.mock.calls.map(([path]) => path)).toEqual([shardPath('t1', 1000)]);
        expect(failed.getCronHistories('t1', Number.MAX_SAFE_INTEGER, 1)[0]!.start).toBe(1000);

        const restarted = await freshService();
        expect(disk.has(`${CRON_DIR}/t1/${CRON_HISTORY_JSONL}`)).toBe(false);
        expect(shardNames()).toEqual([1, 1000]);
        expect(restarted.getCronHistories('t1', 3, 5).map(h => h.start)).toEqual([2, 1]);
        expect(restarted.getCronHistories('t1', Number.MAX_SAFE_INTEGER, 1)[0]!.start).toBe(1000);
    });

    test('names a shard after the first run in it that can be read', async () => {
        // Half a line on a two hundred boundary threw, and since nothing here is destroyed until
        // everything is written, the same file was found and the same throw repeated by every start
        // that followed: one bad line and the record never got sharded at all.
        const lines = runs(HISTORY_SHARD_SIZE + 50);
        lines[50] = '{"start":51,"sta';
        const service = await loadService({
            files: {t1: storedTask()}, legacyLines: `${lines.join('\n')}\n`,
        });
        expect(shardNames()).toEqual([1, 52]);
        expect(disk.has(`${CRON_DIR}/t1/${CRON_HISTORY_JSONL}`)).toBe(false);
        // The run the half line recorded is lost, and it is the only one.
        expect(service.getCronHistories('t1', 53, 3).map(history => history.start))
            .toEqual([52, 50, 49]);
    });

    test('reads a record still kept as one file no further back than a shard', async () => {
        // What fails a migration is usually a full disk, which is the machine least able to afford
        // reading the whole of a record grown to gigabytes to answer one page of twenty.
        const service = await loadService({
            files: {t1: storedTask()},
            legacyLines: `${runs(HISTORY_SHARD_SIZE * 3).join('\n')}\n`,
            unwritable: [CRON_HISTORY_DIR],
        });
        expect(disk.has(`${CRON_DIR}/t1/${CRON_HISTORY_JSONL}`)).toBe(true);
        expect(mocks.readFile).not.toHaveBeenCalledWith(`${CRON_DIR}/t1/${CRON_HISTORY_JSONL}`);
        expect(service.getCronHistories('t1', Number.MAX_SAFE_INTEGER, 1)[0]!.start)
            .toBe(HISTORY_SHARD_SIZE * 3);
        // The bound is a real one: the runs before the last shard's worth wait for the migration.
        expect(service.getCronHistories('t1', HISTORY_SHARD_SIZE * 2 + 1, 5)).toEqual([]);
    });

    test('has nothing to do for a task that never ran', async () => {
        const service = await loadService({files: {t1: storedTask()}});
        expect(shardNames()).toEqual([]);
        expect(mocks.writeFile).not.toHaveBeenCalledWith(
            expect.stringContaining(CRON_HISTORY_DIR), expect.anything()
        );
        expect(service.getCronHistories('t1', Number.MAX_SAFE_INTEGER)).toEqual([]);
    });
});

describe('subscribe', () => {

    let service: CronServiceType;

    beforeEach(async () => {
        service = await loadService();
    });

    test('notifies every subscriber', () => {
        const first = vi.fn();
        const second = vi.fn();
        const unsubscribeFirst = service.subscribe(first);
        const unsubscribeSecond = service.subscribe(second);
        newTask(service);
        unsubscribeFirst();
        unsubscribeSecond();
        expect(first).toHaveBeenCalledTimes(2);
        expect(second).toHaveBeenCalledTimes(2);
    });

    test('stops notifying after the returned unsubscribe was called', () => {
        const subscriber = vi.fn();
        service.subscribe(subscriber)();
        newTask(service);
        expect(subscriber).not.toHaveBeenCalled();
    });

    test('registers the same subscriber only once', () => {
        const subscriber = vi.fn();
        const unsubscribe = service.subscribe(subscriber);
        service.subscribe(subscriber);
        newTask(service);
        unsubscribe();
        expect(subscriber).toHaveBeenCalledTimes(2);
    });
});
