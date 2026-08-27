import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type CronJobHistory, type CronTask} from '@deepclaw/core';
import {newTestContext} from '../../../test-support/one-loop-context';
import {TRUNCATE_THRESHOLD} from '../../loop-utils';
import {CronService} from '../services/cron-service';
import {
    createCronTaskTool, getCronHistoriesTool, HISTORIES_READ_MAX, REPORT_HISTORIES,
    REPORT_KEPT_LENGTH, updateCronOutputTool, updateCronTaskTool
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

/** The runs of the task as the service answers for them, which is newest first. Given oldest first. */
function recorded(histories: CronJobHistory[]): void {
    getCronHistories.mockReturnValue([...histories].reverse());
}

describe('createCronTaskTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        createCronTask.mockReturnValue(cronTask());
        getCronTaskDetail.mockReturnValue(cronTask({histories: []}));
        recorded([]);
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
        recorded([]);
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
        recorded([newHistory({output: {type: 'markdown', content: '# the whole digest'}})]);
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
        recorded([]);
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
        expect(result).toContain(`last max ${REPORT_HISTORIES} histories`);
    });

    /**
     * The task as the service hands it out has already been cut to what a page of the ui shows, so
     * runs taken off it would make this count the smaller of the two and nothing else: raising it
     * would do nothing, while the share of one report, worked out by dividing by it, would shrink to
     * match runs that never arrived.
     */
    test('asks for the runs it carries rather than taking the ones a page shows', async () => {
        await updateCronOutputTool.invoke(
            {id: 'c1', output: {type: 'text', content: 'done'}}, newTestContext()
        );
        expect(getCronHistories)
            .toHaveBeenCalledExactlyOnceWith('c1', Number.MAX_SAFE_INTEGER, REPORT_HISTORIES);
    });

    test('carries the runs oldest first, the way the record reads', async () => {
        recorded([newHistory({start: 1}), newHistory({start: 2})]);
        const result = await updateCronOutputTool.invoke(
            {id: 'c1', output: {type: 'text', content: 'done'}}, newTestContext()
        );
        expect(result.indexOf('"start":1')).toBeLessThan(result.indexOf('"start":2'));
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
        recorded([
            newHistory({output: {type: 'markdown', content: '# the digest of monday'}}),
            newHistory({start: 1755086400000, finalText: 'nothing new to report'}),
        ]);
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
        recorded([newHistory({finalText: 'a'.repeat(2000)})]);
        const result = await updateCronOutputTool.invoke(
            {id: 'c1', output: {type: 'text', content: 'done'}}, newTestContext()
        );
        expect(result).not.toContain('a'.repeat(2000));
        expect(result).toContain('<Report kept, read it with get_cron_histories>');
    });

    /**
     * The share of one report is the budget divided by how many runs stand in the answer, and the
     * two cannot both be written down: a count raised against a share left where it was buys an
     * answer past what a read holds, filed away whole and handed back as a preview of itself, which
     * is a worse answer than fewer runs and the way to the rest of them.
     */
    test('answers within what a read holds however talkative every run was', async () => {
        recorded(Array.from({length: REPORT_HISTORIES}, (_, index) => newHistory({
            start: 1755000000000 + index,
            // As long as a report can be and still stand in the answer, which is the worst the
            // budget ever has to carry.
            finalText: 'a'.repeat(REPORT_KEPT_LENGTH),
        })));
        const result = await updateCronOutputTool.invoke(
            {id: 'c1', output: {type: 'text', content: 'done'}}, newTestContext()
        );
        expect(result.length).toBeLessThan(TRUNCATE_THRESHOLD);
        expect(result).not.toContain('<Report kept, read it with get_cron_histories>');
    });

    /**
     * The share is where a report stops standing in the answer, not where it is cut off: either the
     * whole of it is carried or none of it is, and reading it as a length to truncate to would make
     * the budget above hold for reports it does not.
     */
    test('carries a report up to the share whole and one past it not at all', async () => {
        const under = 'u'.repeat(REPORT_KEPT_LENGTH);
        const over = 'o'.repeat(REPORT_KEPT_LENGTH + 1);
        recorded([
            newHistory({start: 1755000000000, finalText: under}),
            newHistory({start: 1755000000001, finalText: over}),
        ]);
        const result = await updateCronOutputTool.invoke(
            {id: 'c1', output: {type: 'text', content: 'done'}}, newTestContext()
        );
        expect(result).toContain(under);
        expect(result).not.toContain(over.slice(0, 20));
        expect(result).toContain('<Report kept, read it with get_cron_histories>');
    });

    /** An output already filed away has no words left in it, and the path is how it is read. */
    test('leaves an output that was filed away as it lies', async () => {
        recorded([newHistory({output: {
            type: 'markdown',
            content: '<Content saved to file>',
            path: '/api/file/cron/c1/output/1755000000000.md',
        }})]);
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
     * The one run asked for beyond what is wanted came, so the record goes on past this answer and
     * a run walking back through it is told where. The way on names the oldest run of the answer,
     * which the next call reads before rather than again.
     */
    test('names the way further back when the record goes on beyond the answer', async () => {
        getCronHistories.mockReturnValue([
            newHistory({start: 1755172800000, completed: 1755172860000, finalText: 'of wednesday'}),
            newHistory({start: 1755086400000, completed: 1755086460000, finalText: 'of tuesday'}),
            newHistory({start: 1755000000000, completed: 1755000060000, finalText: 'of monday'}),
        ]);
        const result = await getCronHistoriesTool.invoke({id: 'c1', limit: 2}, newTestContext());
        expect(result).toContain('of tuesday');
        expect(result).not.toContain('of monday');
        // Nothing of the sentence stands where the time is copied out of it.
        expect(result).toMatch(/read them with before: 1755086400000$/);
    });

    /**
     * A record that ended within the answer is a record read out, and saying otherwise sends the
     * next call after runs that were never there. Asking for one run more than is wanted is what
     * tells the two apart: the answer is as full as it was asked to be either way.
     */
    test('names no way further back when the record ends inside the answer', async () => {
        getCronHistories.mockReturnValue([
            newHistory({start: 1755086400000, completed: 1755086460000, finalText: 'of tuesday'}),
            newHistory({start: 1755000000000, completed: 1755000060000, finalText: 'of monday'}),
        ]);
        const result = await getCronHistoriesTool.invoke({id: 'c1', limit: 2}, newTestContext());
        expect(result).toContain('of monday');
        expect(result).not.toContain('read them with before');
    });

    /**
     * A run the machine stopped mid way stays in the record with nothing to report, and years of a
     * task collect a few. Held back from the answer they make it shorter than it was asked to be,
     * which is no word on the runs before them.
     */
    test('names the way further back past the runs that reported nothing', async () => {
        getCronHistories.mockReturnValue([
            newHistory({start: 1755172800000}),
            newHistory({start: 1755086400000}),
            newHistory({start: 1755000000000, completed: 1755000060000, finalText: 'of monday'}),
        ]);
        const result = await getCronHistoriesTool.invoke({id: 'c1', limit: 2}, newTestContext());
        expect(result).toContain('of monday');
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
     * A machine restarted a few days in a row leaves as many runs that never got to report, and a
     * window of nothing but those is no more the end of the record than a full one is.
     */
    test('names the way further back when no run of the window reported at all', async () => {
        getCronHistories.mockReturnValue([
            newHistory({start: 1755172800000}),
            newHistory({start: 1755086400000}),
            newHistory({start: 1755000000000}),
        ]);
        const result = await getCronHistoriesTool.invoke({id: 'c1', limit: 2}, newTestContext());
        expect(result).toMatch(/read further back with before: 1755000000000$/);
    });

    test('says so when every run there is died before reporting', async () => {
        getCronHistories.mockReturnValue([newHistory({start: 1755000000000})]);
        expect(await getCronHistoriesTool.invoke({id: 'c1', limit: 2}, newTestContext()))
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
