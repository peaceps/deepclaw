import {beforeEach, describe, expect, test, vi, type Mock} from 'vitest';
import {type CronTask, type LLMTaskOutput, type TokenUsage} from '@deepclaw/core';
import {
    CRON_DIR, CRON_HISTORY_JSONL, CRON_TASK_JSON, FILES_DIR, cronFilesDir, cronOutputDir
} from '../../paths';
import {MAX_DISPLAY_HISTORIES} from './cron-service';

type LoopResult = {text: string; runtime: {usage: TokenUsage; transitionReason: string}};

type FakeJob = {cron: string; started: boolean; timeZone: string; tick: () => Promise<void>; stop: Mock};

const NEXT_RUN = '2024-05-01T03:00:00.000+02:00';
const SESSION_DIR = '.agents/a1/session/cron1';

function newUsage(value = 0): TokenUsage {
    return {cachedInputTokens: value, noCachedInputTokens: value * 2, outputTokens: value * 3};
}

const mocks = vi.hoisted(() => ({
    jobs: [] as FakeJob[],
    isValidCron: vi.fn<(cron: string) => boolean>(() => true),
    nextRun: vi.fn<() => string | null>(() => '2024-05-01T03:00:00.000+02:00'),
    exists: vi.fn<(path: string) => boolean>(() => false),
    readDir: vi.fn<(dir: string) => Record<string, {dir: string; content: string}>>(() => ({})),
    readFile: vi.fn<(path: string) => string>(() => ''),
    writeFile: vi.fn<(path: string, content: string) => string>((path: string) => path),
    appendFile: vi.fn<(path: string, content: string) => void>(() => undefined),
    deleteDir: vi.fn<(path: string) => void>(() => undefined),
    hashString: vi.fn<(text: string) => string>(() => 'titlehash'),
    readBuffer: vi.fn<(path: string) => Buffer>(path => Buffer.from(`bytes of ${path}`)),
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
            writeFile: mocks.writeFile,
            appendFile: mocks.appendFile,
            deleteDir: mocks.deleteDir,
            hashString: mocks.hashString,
            readBuffer: mocks.readBuffer,
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

function primeMocks(): void {
    vi.clearAllMocks();
    mocks.jobs.length = 0;
    mocks.isValidCron.mockReturnValue(true);
    mocks.nextRun.mockReturnValue(NEXT_RUN);
    mocks.writeFile.mockImplementation((path: string) => path);
    mocks.readBuffer.mockImplementation(unfiled);
    mocks.isPathInWorkspace.mockReturnValue(true);
    mocks.isFile.mockReturnValue(true);
    mocks.getSessionDir.mockReturnValue(SESSION_DIR);
    mocks.getLoop.mockReturnValue({invoke: mocks.invoke, getSessionDir: mocks.getSessionDir});
    mocks.invoke.mockResolvedValue({text: 'result', runtime: {usage: newUsage(1), transitionReason: 'end'}});
}

/**
 * The service is a globalized singleton whose statics survive `vi.resetModules`,
 * so the global slot is dropped to give every test its own instance.
 */
async function loadService(
    disk: {files?: Record<string, {dir: string; content: string}>; historyLines?: string} = {}
): Promise<CronServiceType> {
    primeMocks();
    const files = disk.files ?? {};
    mocks.readDir.mockReturnValue(files);
    mocks.readFile.mockReturnValue(disk.historyLines ?? '');
    mocks.exists.mockImplementation((path: string) => {
        if (path === CRON_DIR) {
            return Object.keys(files).length > 0;
        }
        return path.endsWith(CRON_HISTORY_JSONL) && disk.historyLines !== undefined;
    });
    delete (globalThis as unknown as Record<string, unknown>)['__CronService'];
    vi.resetModules();
    return (await import('./cron-service')).CronService;
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

    test('restores the histories from the jsonl file', async () => {
        const service = await loadService({
            files: {t1: storedTask()}, historyLines: `${historyLine(1000)}\n${historyLine(2000)}\n`,
        });
        expect(service.getCronTaskDetail('t1').histories.map(history => history.start)).toEqual([1000, 2000]);
        expect(mocks.readFile).toHaveBeenCalledWith(`${CRON_DIR}/t1/${CRON_HISTORY_JSONL}`);
    });

    test('falls back to an empty history when a line cannot be parsed', async () => {
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
        expect(path).toBe(`${CRON_DIR}/${id}/${CRON_HISTORY_JSONL}`);
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
