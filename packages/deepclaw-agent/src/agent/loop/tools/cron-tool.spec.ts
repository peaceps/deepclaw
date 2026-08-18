import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type CronJobHistory, type CronTask} from '@deepclaw/core';
import {newTestContext} from '../../../test-support/one-loop-context';
import {CronService, MAX_DISPLAY_HISTORIES} from '../services/cron-service';
import {createCronTaskTool, updateCronOutputTool, updateCronTaskTool} from './cron-tool';

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {exists: vi.fn(() => false), readDir: vi.fn(() => ({})), writeFile: vi.fn()},
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

const createCronTask = vi.spyOn(CronService, 'createCronTask');
const updateCronTask = vi.spyOn(CronService, 'updateCronTask');
const updateCronOutput = vi.spyOn(CronService, 'updateCronOutput');
const getCronTaskDetail = vi.spyOn(CronService, 'getCronTaskDetail');

function cronTask(overrides: Partial<CronTask> = {}): CronTask {
    return {id: 'c1', title: 'nightly digest', cron: '0 0 * * *', prompt: 'digest', ...overrides} as CronTask;
}

function newHistory(overrides: Partial<CronJobHistory> = {}): CronJobHistory {
    return {
        start: 1755000000000,
        status: 'success',
        usage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
        ...overrides,
    };
}

describe('createCronTaskTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        createCronTask.mockReturnValue(cronTask());
        getCronTaskDetail.mockReturnValue(cronTask({histories: []}));
    });

    test('creates the task with the current agent as its creator', async () => {
        await createCronTaskTool.invoke(
            {title: 'nightly digest', cron: '0 0 * * *', prompt: 'digest'}, newTestContext()
        );
        expect(createCronTask).toHaveBeenCalledExactlyOnceWith('nightly digest', 'a1', '0 0 * * *', 'digest');
    });

    test('answers with the detail of the task it just created', async () => {
        const result = await createCronTaskTool.invoke(
            {title: 'nightly digest', cron: '0 0 * * *', prompt: 'digest'}, newTestContext()
        );
        expect(getCronTaskDetail).toHaveBeenCalledExactlyOnceWith('c1');
        expect(result).toContain('Cron task created successfully');
        expect(result).toContain(JSON.stringify(cronTask({histories: []})));
    });
});

describe('updateCronTaskTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        updateCronTask.mockReturnValue(cronTask());
        getCronTaskDetail.mockReturnValue(cronTask({histories: []}));
    });

    test('forwards the patch untouched to the service', async () => {
        await updateCronTaskTool.invoke({id: 'c1', title: 'weekly digest'}, newTestContext());
        expect(updateCronTask).toHaveBeenCalledExactlyOnceWith({id: 'c1', title: 'weekly digest'});
    });

    test('answers with the detail of the updated task', async () => {
        const result = await updateCronTaskTool.invoke({id: 'c1', cron: '0 9 * * 1'}, newTestContext());
        expect(result).toContain('Cron task updated successfully');
        expect(result).toContain('"id":"c1"');
    });

    /** A patch of the schedule is no reason to read every report of the task back. */
    test('leaves what the runs reported out of the answer', async () => {
        getCronTaskDetail.mockReturnValue(cronTask({
            histories: [newHistory({output: {type: 'markdown', content: '# the whole digest'}})],
        }));
        const result = await updateCronTaskTool.invoke({id: 'c1', cron: '0 9 * * 1'}, newTestContext());
        expect(result).not.toContain('the whole digest');
        expect(result).toContain('<Output kept>');
    });
});

describe('updateCronOutputTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        updateCronOutput.mockReturnValue({skipped: []});
        getCronTaskDetail.mockReturnValue(cronTask({histories: []}));
    });

    test('stores the output on the task', async () => {
        const output = {type: 'markdown' as const, content: '# report'};
        await updateCronOutputTool.invoke({id: 'c1', output}, newTestContext());
        expect(updateCronOutput).toHaveBeenCalledExactlyOnceWith('c1', output, undefined);
    });

    test('tells the agent how many histories the detail contains', async () => {
        const result = await updateCronOutputTool.invoke(
            {id: 'c1', output: {type: 'text', content: 'done'}}, newTestContext()
        );
        expect(result).toContain(`last max ${MAX_DISPLAY_HISTORIES} histories`);
    });

    /** The files are what to hand over, the output is what is kept: they travel apart. */
    test('hands the files of the run over beside the output it keeps', async () => {
        await updateCronOutputTool.invoke({
            id: 'c1',
            output: {type: 'markdown', content: '# report', generatedFiles: ['out/digest.csv']},
        }, newTestContext());
        expect(updateCronOutput).toHaveBeenCalledExactlyOnceWith(
            'c1', {type: 'markdown', content: '# report'}, ['out/digest.csv']
        );
    });

    /**
     * The run recorded its report a moment ago, and every run before it carries one of its own: read
     * back together they crowd everything else out of the answer, or truncate the whole of it.
     */
    test('leaves what the runs reported out of the answer', async () => {
        getCronTaskDetail.mockReturnValue(cronTask({histories: [
            newHistory({output: {type: 'markdown', content: '# the digest of monday'}}),
            newHistory({start: 1755086400000, finalText: 'nothing new to report'}),
        ]}));
        const result = await updateCronOutputTool.invoke(
            {id: 'c1', output: {type: 'markdown', content: '# the digest of tuesday'}}, newTestContext()
        );
        expect(result).not.toContain('the digest of monday');
        expect(result).toContain('<Output kept>');
        // What a run said of itself is short and is what the next one is told by, it stays.
        expect(result).toContain('nothing new to report');
    });

    /** An output already filed away has no words left in it, and the path is how it is read. */
    test('leaves an output that was filed away as it lies', async () => {
        getCronTaskDetail.mockReturnValue(cronTask({histories: [newHistory({output: {
            type: 'binary',
            content: '<Content saved to file>',
            path: '/api/file/cron/c1/output/1755000000000.out',
        }})]}));
        const result = await updateCronOutputTool.invoke(
            {id: 'c1', output: {type: 'text', content: 'done'}}, newTestContext()
        );
        expect(result).toContain('"path":"/api/file/cron/c1/output/1755000000000.out"');
        expect(result).toContain('<Content saved to file>');
        expect(result).not.toContain('<Output kept>');
    });

    test('says which files never reached the user', async () => {
        updateCronOutput.mockReturnValue({skipped: ['/tmp/secret.pdf']});
        const result = await updateCronOutputTool.invoke({
            id: 'c1',
            output: {type: 'markdown', content: '# report', generatedFiles: ['/tmp/secret.pdf']},
        }, newTestContext());
        expect(result).toContain('These files were not handed to the user');
        expect(result).toContain('/tmp/secret.pdf');
    });
});

describe('cron tool metadata', () => {

    test('every cron tool is kept out of spawned loops but runs next to other tool calls', () => {
        for (const tool of [createCronTaskTool, updateCronTaskTool, updateCronOutputTool]) {
            expect(tool.parallelSafe).toBe(true);
            expect(tool.loopKinds).toEqual(['main']);
            expect(tool.agentMode).toEqual(['agent']);
        }
        expect(updateCronTaskTool.tool.schema.required).toEqual(['id']);
    });
});
