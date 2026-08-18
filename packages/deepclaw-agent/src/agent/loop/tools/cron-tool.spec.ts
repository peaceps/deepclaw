import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type CronJobHistory, type CronTask} from '@deepclaw/core';
import {newTestContext} from '../../../test-support/one-loop-context';
import {CronService, MAX_DISPLAY_HISTORIES} from '../services/cron-service';
import {
    createCronTaskTool, getCronHistoriesTool, HISTORIES_READ_MAX, updateCronOutputTool,
    updateCronTaskTool
} from './cron-tool';

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {exists: vi.fn(() => false), readDir: vi.fn(() => ({})), writeFile: vi.fn()},
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

const createCronTask = vi.spyOn(CronService, 'createCronTask');
const updateCronTask = vi.spyOn(CronService, 'updateCronTask');
const updateCronOutput = vi.spyOn(CronService, 'updateCronOutput');
const getCronTaskDetail = vi.spyOn(CronService, 'getCronTaskDetail');
const getCronHistories = vi.spyOn(CronService, 'getCronHistories');

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
        expect(result).toContain('<Output kept, read it with get_cron_histories>');
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

    /** A file of the run is handed over from disk, its bytes in the call would only be paid for. */
    test('turns away an output that carries a file instead of words', async () => {
        await expect(updateCronOutputTool.invoke({
            id: 'c1', output: {type: 'binary', content: 'QUJD', generatedFiles: ['out/digest.csv']},
        }, newTestContext())).rejects.toThrow('not the bytes of a file');
        expect(updateCronOutput).not.toHaveBeenCalled();
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
        expect(result).toContain('<Output kept, read it with get_cron_histories>');
        // What a run said of itself is short, and short enough to say here what became of it.
        expect(result).toContain('nothing new to report');
    });

    /**
     * Short is what most runs sign off in and nothing a run is held to. As many of them stand in
     * this answer as the record shows, so one that went on at length is read where reports are read.
     */
    test('leaves the words of a run that went on at length out of the answer', async () => {
        getCronTaskDetail.mockReturnValue(cronTask({
            histories: [newHistory({finalText: 'a'.repeat(2000)})],
        }));
        const result = await updateCronOutputTool.invoke(
            {id: 'c1', output: {type: 'text', content: 'done'}}, newTestContext()
        );
        expect(result).not.toContain('a'.repeat(2000));
        expect(result).toContain('<Report kept, read it with get_cron_histories>');
    });

    /** An output already filed away has no words left in it, and the path is how it is read. */
    test('leaves an output that was filed away as it lies', async () => {
        getCronTaskDetail.mockReturnValue(cronTask({histories: [newHistory({output: {
            type: 'markdown',
            content: '<Content saved to file>',
            path: '/api/file/cron/c1/output/1755000000000.md',
        }})]}));
        const result = await updateCronOutputTool.invoke(
            {id: 'c1', output: {type: 'text', content: 'done'}}, newTestContext()
        );
        expect(result).toContain('"path":"/api/file/cron/c1/output/1755000000000.md"');
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

describe('getCronHistoriesTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        getCronHistories.mockReturnValue([]);
    });

    test('reads back what the runs before this one reported', async () => {
        getCronHistories.mockReturnValue([newHistory({
            completed: 1755000060000, output: {type: 'markdown', content: '# the digest of monday'},
        })]);
        const result = await getCronHistoriesTool.invoke({id: 'c1'}, newTestContext());
        expect(result).toContain('the digest of monday');
    });

    test('reads the latest runs of the task by default', async () => {
        await getCronHistoriesTool.invoke({id: 'c1'}, newTestContext());
        expect(getCronHistories).toHaveBeenCalledWith('c1', Number.MAX_SAFE_INTEGER, 4);
    });

    test('walks further back from the run the caller names', async () => {
        await getCronHistoriesTool.invoke({id: 'c1', before: 1755000000000, limit: 2}, newTestContext());
        expect(getCronHistories).toHaveBeenCalledWith('c1', 1755000000000, 3);
    });

    /** One answer carries every report it names, and a record of a year is no answer. */
    test('reads back no more runs than one answer may carry', async () => {
        await getCronHistoriesTool.invoke({id: 'c1', limit: 50}, newTestContext());
        // As many as one call may ask for, and one more for the run that is asking.
        expect(getCronHistories)
            .toHaveBeenCalledWith('c1', Number.MAX_SAFE_INTEGER, HISTORIES_READ_MAX + 1);
    });

    /**
     * A report is as long as the run made it. Past what one answer holds, the whole of it is filed
     * away and comes back as a preview and a path: fewer runs and the way on is the better answer.
     */
    test('carries no more reports than one answer holds and says where the rest are', async () => {
        getCronHistories.mockReturnValue([
            newHistory({start: 1755086400000, completed: 1755086460000, finalText: 'a'.repeat(9000)}),
            newHistory({start: 1755000000000, completed: 1755000060000, finalText: 'b'.repeat(9000)}),
        ]);
        const result = await getCronHistoriesTool.invoke({id: 'c1', limit: 2}, newTestContext());
        expect(result).toContain('a'.repeat(9000));
        expect(result).not.toContain('b'.repeat(9000));
        expect(result).toContain('read them with before: 1755086400000');
    });

    /** A run that reported at length is still the run that was asked about. */
    test('carries the report of one run however long it is', async () => {
        getCronHistories.mockReturnValue([
            newHistory({completed: 1755000060000, finalText: 'a'.repeat(30000)}),
        ]);
        const result = await getCronHistoriesTool.invoke({id: 'c1'}, newTestContext());
        expect(result).toContain('a'.repeat(30000));
        expect(result).not.toContain('read them with before');
    });

    /**
     * The run that asks is a history of its own by then, one that has nothing to report yet, and
     * asking for one more than was wanted keeps it from taking the place of a run that has.
     */
    test('leaves the run that is still going out of the answer', async () => {
        getCronHistories.mockReturnValue([
            newHistory({start: 1755086400000}),
            newHistory({completed: 1755000060000, finalText: 'the digest of monday'}),
        ]);
        const result = await getCronHistoriesTool.invoke({id: 'c1', limit: 1}, newTestContext());
        expect(result).toContain('the digest of monday');
        expect(JSON.parse(result.split('\n')[0]!)).toHaveLength(1);
    });

    /**
     * A caller that got as much as it asked for heard nothing about what lies before that, and a run
     * walking back through the record reads no way further back as the end of it.
     */
    test('names the way further back when the answer is as full as it was asked to be', async () => {
        getCronHistories.mockReturnValue([
            newHistory({start: 1755086400000, completed: 1755086460000, finalText: 'of tuesday'}),
            newHistory({start: 1755000000000, completed: 1755000060000, finalText: 'of monday'}),
        ]);
        const result = await getCronHistoriesTool.invoke({id: 'c1', limit: 2}, newTestContext());
        expect(result).toContain('of monday');
        // Nothing of the sentence stands where the time is copied out of it.
        expect(result).toMatch(/read them with before: 1755000000000$/);
    });

    /**
     * A run records its report before it is over, and the answer to that write points here for the
     * words of it. Held back for not being over yet, the one report named there is the one report
     * that could not be read, and a filed one is reachable no other way from inside that run.
     */
    test('reads back the run that is still going once it has reported', async () => {
        getCronHistories.mockReturnValue([newHistory({start: 1755086400000, output: {
            type: 'markdown',
            content: '<Content saved to file>',
            path: '/api/file/cron/c1/output/1755086400000.md',
        }})]);
        const result = await getCronHistoriesTool.invoke({id: 'c1', limit: 1}, newTestContext());
        expect(result).toContain('"file":".cron/c1/output/1755086400000.md"');
    });

    test('says so when the task has nothing to read back', async () => {
        expect(await getCronHistoriesTool.invoke({id: 'c1'}, newTestContext()))
            .toBe('This cron task has no finished run to read back.');
    });

    /**
     * A report too long to be kept in the record was filed, and what stands there is the link the
     * user opens it by. An agent opens the file itself, and cannot fetch a route of the app.
     */
    test('names the file of a report that was filed away, not the link to it', async () => {
        getCronHistories.mockReturnValue([newHistory({completed: 1755000060000, output: {
            type: 'markdown',
            content: '<Content saved to file>',
            path: '/api/file/cron/c1/output/1755000000000.md',
        }})]);
        const result = await getCronHistoriesTool.invoke({id: 'c1'}, newTestContext());
        expect(result).toContain('"file":".cron/c1/output/1755000000000.md"');
        expect(result).not.toContain('/api/file/');
    });

    test('leaves a report that is kept in the record as it lies', async () => {
        getCronHistories.mockReturnValue([newHistory({
            completed: 1755000060000, output: {type: 'text', content: 'nothing new'},
        })]);
        const result = await getCronHistoriesTool.invoke({id: 'c1'}, newTestContext());
        expect(result).toContain('"content":"nothing new"');
        expect(result).not.toContain('"file"');
    });
});

describe('cron tool metadata', () => {

    test('every cron tool is kept out of spawned loops but runs next to other tool calls', () => {
        for (const tool of [
            createCronTaskTool, updateCronTaskTool, updateCronOutputTool, getCronHistoriesTool
        ]) {
            expect(tool.parallelSafe).toBe(true);
            expect(tool.loopKinds).toEqual(['main']);
            expect(tool.agentMode).toEqual(['agent']);
        }
        expect(updateCronTaskTool.tool.schema.required).toEqual(['id']);
    });
});
