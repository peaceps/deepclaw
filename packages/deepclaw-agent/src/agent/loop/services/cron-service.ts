import { CronJob, CronTime } from 'cron';
import {
    addTokenUsage, MAX_DISPLAY_HISTORIES, type CronTask, type CronJobHistory, type LLMTaskOutput
} from "@deepclaw/core";
import { fileAwayOutput, publishGeneratedFiles } from '../../loop-utils';
import {
    CRON_DIR, CRON_HISTORY_DIR, CRON_HISTORY_JSONL, CRON_TASK_JSON, cronFilesDir, cronOutputDir
} from '../../paths';
import { FileUtils, UpdateContent, getLogger } from '@deepclaw/node-utils';
import { randomUUID } from 'node:crypto';
import { globalize } from '@deepclaw/utils';

const logger = getLogger('CronService');

/**
 * The runs these lines record, with any line recording none passed over.
 *
 * The record is appended a line at a time, so a process killed mid append leaves half a line behind:
 * over the years one of these files is written across, that is a thing to expect rather than a thing
 * that cannot happen. Reading it as an error loses whatever it was read with -- the window of a task,
 * a shard of two hundred runs, or, where a shard is named after a line, every future attempt at the
 * same migration. Taken a line at a time, half a line costs itself and nothing else.
 *
 * One line is logged for the read rather than one for each line passed over: the same broken line is
 * met again by every page that reaches the shard holding it, and a record is worth a line in the log
 * saying so, not a line every time somebody scrolls.
 */
function historiesIn(lines: string[], source: string): CronJobHistory[] {
    const histories: CronJobHistory[] = [];
    let passedOver = 0;
    for (const line of lines) {
        try {
            histories.push(JSON.parse(line) as CronJobHistory);
        } catch {
            passedOver++;
        }
    }
    if (passedOver) {
        logger.warn(`Passed over ${passedOver} line(s) of ${source} recording no run.`);
    }
    return histories;
}

/**
 * How many runs of one task stay in memory.
 *
 * The record of a task is the one thing here that grows with time rather than with use: nobody has
 * to touch a task for it to keep running, and every run appends. A task on a five minute schedule
 * writes a hundred thousand of them in a year, so holding all of them -- which is what reading the
 * whole file at startup came to -- is the one structure in this process that can reach gigabytes.
 *
 * It has to stay above `MAX_DISPLAY_HISTORIES`, and by enough to cover the run in flight, the first
 * screen, and the first page back. A window at or under what a screen shows would send every first
 * screen to disk, which is the work of a window with none of the point of one.
 */
export const MEMORY_HISTORY_WINDOW = 40;

/**
 * How many runs one shard of the record holds before the next is opened.
 *
 * A shard is the grain of a read: paging past the window wants twenty runs, and reading two hundred
 * to find them wastes less than half of what reading five hundred would. It is also the grain of
 * throwing away, and a shard is only ever appended to or deleted whole, never rewritten.
 */
export const HISTORY_SHARD_SIZE = 200;

/**
 * How many shards of a task are kept, the oldest going when the next is opened.
 *
 * Five thousand runs, which is thirteen years of a daily task, two hundred days of an hourly one and
 * seventeen days of one running every five minutes. Unlike memory this cannot be cut to what a
 * screen shows: the record is the only memory a run has of the runs before it, so what is deleted
 * here a task writing a monthly digest can no longer read.
 *
 * The one use this shuts out is a long look back by a frequent task -- a month of runs at five minute
 * intervals is eight thousand six hundred, past the limit. The judgement is that the combination does
 * not arise, and that this is the number to raise first if it does.
 */
export const HISTORY_SHARDS_KEPT = 25;

export type CronScheduledJob = {
    job: CronJob;
    running: boolean;
}

/** One shard of the record: where it lies, and the run it opens with, which is what it is named. */
type HistoryShard = {
    path: string;
    firstStart: number;
}

class CronServiceImpl {
    private static subscribers: Set<(task: UpdateContent<CronTask>) => void> = new Set();
    private static cronTasks: Record<string, CronTask>;
    private static cronScheduledJob: Record<string, CronScheduledJob>;
    /** Where the appends of each task go, and how full it is. See `appendHistory`. */
    private static shardCursors: Record<string, {path: string; count: number}>;

    public static loadCronTasks(): void {
        if (!!this.cronTasks) return;
        this.cronTasks = {};
        this.cronScheduledJob = {};
        this.shardCursors = {};
        if (!FileUtils.exists(CRON_DIR)) {
            return;
        }
        const cronTaskFiles = FileUtils.readDir(CRON_DIR, dir => `${dir}/${CRON_TASK_JSON}`);
        for (const {dir, content} of Object.values(cronTaskFiles)) {
            try {
                const cronTask = JSON.parse(content) as CronTask;
                if (cronTask.closed) continue;
                // The persisted task never carries its histories, they live in the jsonl next to it.
                cronTask.histories = [];
                this.cronTasks[cronTask.id] = cronTask;
                try {
                    this.migrateHistory(cronTask.id);
                    // Only the end of it: what a page of the ui asks for and what a run asks of the
                    // runs before it both start from the newest, and the rest is on disk to be read
                    // back when somebody pages past this.
                    cronTask.histories = this.rememberedTail(cronTask.id);
                } catch (error) {
                    cronTask.histories = [] as CronJobHistory[];
                    logger.error(`Failed to load cron task history ${cronTask.id}: ${error}`);
                }
                if (cronTask.paused) continue;
                this.scheduleCronTask(cronTask);
            } catch (error) {
                logger.error(`Failed to load cron task ${dir}: ${error}`);
            }
        }
    }

    public static createCronTask(title: string, creator: string, cron: string, prompt: string): CronTask {
        const id = randomUUID();
        const cronTask: CronTask = {
            id,
            title,
            creator,
            cron,
            prompt,
            usage: {
                cachedInputTokens: 0,
                noCachedInputTokens: 0,
                outputTokens: 0,
            },
            histories: [],
        };
        this.cronTasks[id] = cronTask;
        this.saveTask(cronTask);
        try {
            this.scheduleCronTask(cronTask);
        } catch (error) {
            // An unschedulable task must not survive, it would come back on every start.
            delete this.cronTasks[id];
            FileUtils.deleteDir(`${CRON_DIR}/${id}`);
            throw error;
        }
        this.notify(cronTask);
        return cronTask;
    }

    public static scheduleCronTask(cronTask: CronTask): void {
        if (this.cronScheduledJob[cronTask.id]) return;
        const job = new CronJob(
            cronTask.cron,
            () => this.onTick(cronTask), 
            null,
            true,
            Intl.DateTimeFormat().resolvedOptions().timeZone
        );
        cronTask.nextRun = job.nextDate().toISO() || '';
        this.notify({id: cronTask.id, nextRun: cronTask.nextRun});
        this.cronScheduledJob[cronTask.id] = {
            job,
            running: false,
        };
    }

    private static async onTick(cronTask: CronTask): Promise<void> {
        const job = this.cronScheduledJob[cronTask.id];
        if (!job) return;
        if (job.running) {
            logger.warn(`Cron task ${cronTask.id} is already running, skipping...`);
            return;
        }
        job.running = true;
        const { LoopInitializer } = await import('../../loop-initializer');
        const loop = LoopInitializer.getLoop('cron', cronTask.creator, cronTask.id, {
            onStreamText: () => {},
            onInteractionEvent: () => Promise.resolve(''),
            onInfoEvent: () => {}
        });
        const history: CronJobHistory = {
            start: Date.now(),
            status: 'running',
            usage: {
                cachedInputTokens: 0,
                noCachedInputTokens: 0,
                outputTokens: 0,
            },
        };
        // Trimmed as it grows, or a process left running long enough would hold every run of every
        // task again and the window would have moved the problem to startup rather than solved it.
        // The front is what goes: the run in flight is the last, `updateCronOutput` reaches for it
        // there, and every other reader of this array works out its indices afresh.
        cronTask.histories.push(history);
        if (cronTask.histories.length > MEMORY_HISTORY_WINDOW) {
            cronTask.histories.splice(0, cronTask.histories.length - MEMORY_HISTORY_WINDOW);
        }
        cronTask.lastRun = new Date(history.start).toISOString();
        cronTask.nextRun = job.job.nextDate().toISO() || '';
        this.saveTask(cronTask);
        this.notify({
            id: cronTask.id,
            lastRun: cronTask.lastRun,
            nextRun: cronTask.nextRun,
            histories: cronTask.histories.slice(-MAX_DISPLAY_HISTORIES),
        });

        try {
            const {text, runtime} = await loop.invoke(cronTask.prompt, {browserId: ''});
            history.finalText = text;
            addTokenUsage(history.usage, runtime.usage);
            addTokenUsage(cronTask.usage, history.usage);
            history.status = runtime.transitionReason === 'error' ? 'failed' : 'success';
        } catch (error) {
            const text = `Failed to run cron task ${cronTask.id}: ${error}`;
            history.status = 'failed';
            history.finalText = text;
        }
        history.completed = Date.now();
        this.notify({
            id: cronTask.id,
            usage: cronTask.usage,
            histories: cronTask.histories.slice(-MAX_DISPLAY_HISTORIES),
        });
        try {
            this.appendHistory(cronTask.id, history);
            FileUtils.deleteDir(loop.getSessionDir());
        } catch (error) {
            logger.error(`Failed to save cron task ${cronTask.id} history: ${error}`);
        } finally {
            job.running = false;
        }
    }

    public static updateCronTask(updateTask: {id: string; title?: string, cron?: string; prompt?: string}): CronTask {
        const task = this.getCronTask(updateTask.id);
        if (updateTask.cron) {
            this.requireSchedulable(updateTask.cron);
        }
        Object.assign(task, Object.fromEntries(
            Object.entries(updateTask).filter(([k, v]) => k !== 'id' && !!v)
        ));

        if (!task.paused && (updateTask.cron || updateTask.prompt)) {
            this.stopCronJob(task.id);
            this.scheduleCronTask(task);
        }
        this.notify({
            id: task.id,
            title: task.title,
            cron: task.cron,
            prompt: task.prompt
        });
        this.saveTask(task);
        return task;
    }

    /**
     * A schedule that schedules nothing, refused before anything has been changed by it.
     *
     * Refused here rather than where the job is built, because by then the task is carrying the new
     * expression and its old job has been stopped: what the throw from there leaves behind is a task
     * that runs at no time at all, until a restart reads the saved expression back and schedules it
     * again. Asked of the same clock the job would be built on, so nothing passing this can fail
     * there.
     */
    private static requireSchedulable(cron: string): void {
        const {valid, error} = CronTime.validateCronExpression(cron);
        if (!valid) {
            throw new Error(`Invalid cron expression ${cron}: ${error?.message ?? 'it names no time'}`);
        }
    }

    /**
     * The files of a scheduled run reach the user the way those of a task do, and the run has to
     * hear which of them did not: nobody is watching it to notice an empty hand over.
     */
    public static updateCronOutput(
        id: string, output: LLMTaskOutput, generatedFiles?: string[]
    ): {skipped: string[]} {
        const cronTask = this.getCronTask(id);
        const history = cronTask.histories[cronTask.histories.length - 1];
        if (!history) {
            throw new Error('No history found for cron task.');
        }
        if (history.completed) {
            throw new Error('Cron task already completed.');
        }
        history.output = output;
        if (!output) {
            return {skipped: generatedFiles ?? []};
        }
        // The links go in before the output is filed away, so the saved report carries them.
        const skipped = generatedFiles?.length
            ? publishGeneratedFiles(output, generatedFiles, cronFilesDir(id)).skipped : [];
        fileAwayOutput(output, cronOutputDir(id), String(history.start));
        return {skipped};
    }

    public static updateCronTaskStatus({id, pause, close}: {id: string, pause?: boolean; close?: boolean}) {
        const job = this.cronScheduledJob[id];
        const task = this.getCronTask(id);
        if (close) {
            this.stopCronJob(id);
            task.closed = true;
            task.paused = true;
            task.nextRun = undefined;
            delete this.cronTasks[id];
        } else {
            task.paused = pause;
            if (pause) {
                this.stopCronJob(id);
                task.nextRun = undefined;
            } else if (!job) {
                this.scheduleCronTask(task);
            }
        }
        this.saveTask(task);
        this.notify({
            id: task.id,
            paused: task.paused,
            closed: task.closed,
            nextRun: task.nextRun,
        });
    }

    private static stopCronJob(id: string) {
        const job = this.cronScheduledJob[id];
        if (job) {
            job.job.stop();
        }
        delete this.cronScheduledJob[id];
    }

    private static getCronTask(id: string): CronTask {
        const cronTask = this.cronTasks[id];
        if (!cronTask) {
            throw new Error('Cron task not found.');
        }
        return cronTask;
    }

    public static getCronTasks(): CronTask[] {
        return Array.from(Object.values(this.cronTasks)).map(task => this.getCronTaskDetail(task.id));
    }

    public static getCronTaskDetail(id: string): CronTask {
        const cronTask = this.getCronTask(id);
        return {
            ...cronTask,
            histories: cronTask.histories.slice(-MAX_DISPLAY_HISTORIES),
        };
    }

    /**
     * The runs before a moment, newest first, however far back that moment is.
     *
     * Memory holds the end of the record and nothing more, so a page that cannot be proved to lie
     * inside what memory holds is answered off the disk instead. Proved is the word: the page is
     * complete when the runs asked for were found without the slice running off the front of the
     * array, and running off the front reads the same whether the record ends there or memory does.
     * So the disk is asked in both cases, which costs a read at the very end of paging and buys not
     * having to keep track of which of the two it was.
     */
    public static getCronHistories(
        id: string, beforeStart: number, limit: number = MAX_DISPLAY_HISTORIES
    ): CronJobHistory[] {
        const cronTask = this.getCronTask(id);
        const remembered = this.pageOf(cronTask.histories, beforeStart, limit);
        return remembered.complete
            ? remembered.histories
            : this.olderPage(cronTask, beforeStart, limit);
    }

    private static pageOf(
        all: CronJobHistory[], beforeStart: number, limit: number
    ): {histories: CronJobHistory[], complete: boolean} {
        const older = all.findIndex(h => h.start >= beforeStart);
        const end = older === -1 ? all.length : older;
        const from = end - limit;
        return {histories: all.slice(Math.max(0, from), end).reverse(), complete: from >= 0};
    }

    /**
     * The runs before a moment read off the disk, newest first, as many as were asked for.
     *
     * Only the shards that can hold such a run are opened. A shard is named for the run it opens
     * with and its runs ascend from there, so one named at or after the moment asked about holds
     * nothing before it and is not read at all; the rest are walked from the newest back until the
     * page is full, which for a page of twenty is one shard, or two across a boundary.
     *
     * Memory is asked first and the disk after it, because a run reaches the disk when it completes
     * and reading the disk alone would answer a task on its first run with nothing at all. The two
     * overlap -- the window reaches back into what is already stored -- so the page remembers the
     * runs it has taken and the walk over the shards passes over them.
     *
     * Remembering them is what keeps a run out of a page twice, rather than working out where the
     * disk ends and answering from memory only past that point. Working it out means reading
     * something, reading can fail, and every way it fails reads as "the disk has nothing", which is
     * the answer that puts the whole window into the page and then reads the same runs out of the
     * shards behind it. What has already been put in the page is the one thing here that cannot be
     * got wrong.
     */
    private static olderPage(
        cronTask: CronTask, beforeStart: number, limit: number
    ): CronJobHistory[] {
        const shards = this.shardsOf(cronTask.id);
        const page: CronJobHistory[] = [];
        const taken = new Set<number>();
        for (let index = cronTask.histories.length - 1; index >= 0; index--) {
            const history = cronTask.histories[index]!;
            if (history.start >= beforeStart) continue;
            page.push(history);
            taken.add(history.start);
            if (page.length === limit) return page;
        }
        for (let index = shards.length - 1; index >= 0; index--) {
            const shard = shards[index]!;
            if (shard.firstStart >= beforeStart) continue;
            for (const history of this.readShard(shard).reverse()) {
                if (history.start >= beforeStart || taken.has(history.start)) continue;
                page.push(history);
                if (page.length === limit) return page;
            }
        }
        return page;
    }

    /** The last runs of the record, for the memory window to open with, oldest of them first. */
    private static rememberedTail(id: string): CronJobHistory[] {
        const shards = this.shardsOf(id);
        const lines: string[] = [];
        for (let index = shards.length - 1; index >= 0 && lines.length < MEMORY_HISTORY_WINDOW; index--) {
            lines.unshift(
                ...FileUtils.readTailLines(shards[index]!.path, MEMORY_HISTORY_WINDOW - lines.length)
            );
        }
        return historiesIn(lines, this.historyDirOf(id));
    }

    /**
     * The runs of one shard, which is usually all of them: a shard is only ever appended to until
     * it holds `HISTORY_SHARD_SIZE` of them, so reading that many lines from the end reads the
     * whole of it.
     *
     * The bound in lines is for the shard that is not one. A record kept as one file stands in for
     * a shard until a migration turns it into several, and that file is the gigabytes this whole
     * scheme exists to keep out of memory; reading it whole here would undo that on the machine
     * least able to afford it, since what fails a migration is usually the disk being full. What
     * the bound costs is that such a record can be paged back through its newest shard's worth of
     * runs and no further, until the migration it is waiting for goes through.
     *
     * The bound in bytes is for all of them, a real shard included, and it is why "all of them" is
     * only usually. Two hundred runs that each wrote a page come to more than one read may take,
     * and what comes back is the newest of them rather than the whole; the page shows that much of
     * the shard and reaches the one before it sooner. What that leaves unread is in the middle of
     * the record rather than off the end of it, and it stays unread however far back the paging
     * goes, since every page over that shard is the same read answering the same way.
     */
    private static readShard(shard: HistoryShard): CronJobHistory[] {
        try {
            return historiesIn(FileUtils.readTailLines(shard.path, HISTORY_SHARD_SIZE), shard.path);
        } catch (error) {
            logger.error(`Failed to read cron history shard ${shard.path}: ${error}`);
            return [];
        }
    }

    /**
     * The shards of a task, oldest first, by the name each carries rather than by when it was
     * written: a migration writes every shard in the same moment, and a record restored from a
     * backup carries whatever times the copy gave it.
     *
     * A record that was never sharded stands in for one shard covering everything, which is what a
     * reader gets before a migration and after one that failed -- but only until this process
     * records a run. That opens a shard, and where there are shards the file is not read: paging
     * back then reaches the runs this process wrote and the window in memory and stops, until the
     * next start shards the file and the rest of it comes back. Nothing is lost in the meantime,
     * the file being left exactly where the migration found it.
     *
     * It is left out rather than answered alongside the shards because a migration that failed
     * part way had already written its newest ones, and what those hold is what the end of the
     * file holds. A page passes over what it took from memory and not over what one shard gave it
     * when reading the next, so a run written in both would be shown twice. Reaching less far back
     * until the next start is the smaller wrong of the two.
     */
    private static shardsOf(id: string): HistoryShard[] {
        const dir = this.historyDirOf(id);
        const shards = FileUtils.listFiles(dir)
            .filter(name => name.endsWith('.jsonl'))
            .map(name => ({path: `${dir}/${name}`, firstStart: Number.parseInt(name, 10)}))
            .filter(shard => Number.isFinite(shard.firstStart))
            .sort((one, other) => one.firstStart - other.firstStart);
        if (shards.length) {
            return shards;
        }
        const legacy = this.legacyHistoryFileOf(id);
        return FileUtils.exists(legacy) ? [{path: legacy, firstStart: 0}] : [];
    }

    private static historyDirOf(id: string): string {
        return `${CRON_DIR}/${id}/${CRON_HISTORY_DIR}`;
    }

    private static legacyHistoryFileOf(id: string): string {
        return `${CRON_DIR}/${id}/${CRON_HISTORY_JSONL}`;
    }

    /**
     * Records the run that just finished, opening a new shard when the one being written is full and
     * dropping the oldest shards once there are more than are kept.
     *
     * How full the shard being written is comes from counting its lines the first time this process
     * appends to the task and from counting the appends after that: this is the only writer of the
     * record, so nothing else can make the count wrong, and a shard is small enough that the one
     * read costs less than reading it on every run would.
     */
    private static appendHistory(id: string, history: CronJobHistory): void {
        let cursor = this.shardCursors[id] ?? this.openShardCursor(id);
        if (cursor.count >= HISTORY_SHARD_SIZE) {
            cursor = {path: `${this.historyDirOf(id)}/${history.start}.jsonl`, count: 0};
            this.shardCursors[id] = cursor;
        }
        FileUtils.appendFile(cursor.path, `${JSON.stringify(history)}\n`);
        cursor.count++;
        this.dropOldestShards(id);
    }

    /**
     * Where the appends of this process go, which is the newest shard there is unless it is full.
     * A record that was never sharded has none to append to: it is left where it is for a migration
     * to read, and this process writes a shard of its own.
     *
     * How full that shard is comes from counting the lines read back out of it, and such a read is
     * held to bytes as well as to lines. A shard whose two hundred runs come to more than a read
     * may take answers with fewer lines than it holds, and this process appends to a shard that is
     * already full. The count it keeps from there is its own, so it overshoots by what the read
     * fell short of and then opens a new shard -- but the next start reads short again, and a
     * shard like that takes another overshoot every time the process is restarted. It takes runs
     * averaging a hundred and sixty kilobytes of json apiece to reach, which is a task filing
     * pages rather than lines, and what it costs is a shard some multiple of the size intended.
     * Reading it back costs no more than any other, that read being bounded by the same bytes.
     */
    private static openShardCursor(id: string): {path: string; count: number} {
        const shards = FileUtils.listFiles(this.historyDirOf(id)).filter(name => name.endsWith('.jsonl'));
        const newest = shards.map(name => Number.parseInt(name, 10))
            .filter(Number.isFinite).sort((one, other) => one - other).pop();
        const cursor = newest === undefined
            ? {path: '', count: HISTORY_SHARD_SIZE}
            : {
                path: `${this.historyDirOf(id)}/${newest}.jsonl`,
                count: FileUtils.readTailLines(`${this.historyDirOf(id)}/${newest}.jsonl`, HISTORY_SHARD_SIZE).length,
            };
        this.shardCursors[id] = cursor;
        return cursor;
    }

    /**
     * Throws away the shards past what is kept, and keeps its failures to itself: this runs off the
     * back of an append that has already gone through, and letting a delete that would not carry
     * report the run as unrecorded -- and skip the tidying that follows the append -- would make a
     * housekeeping failure look like a data loss and cause a smaller one along the way.
     */
    private static dropOldestShards(id: string): void {
        try {
            const dir = this.historyDirOf(id);
            const shards = FileUtils.listFiles(dir).filter(name => name.endsWith('.jsonl'))
                .map(name => Number.parseInt(name, 10)).filter(Number.isFinite)
                .sort((one, other) => one - other);
            for (const start of shards.slice(0, Math.max(0, shards.length - HISTORY_SHARDS_KEPT))) {
                FileUtils.deleteFile(`${dir}/${start}.jsonl`);
            }
        } catch (error) {
            logger.error(`Failed to drop the oldest history shards of cron task ${id}: ${error}`);
        }
    }

    /**
     * Turns a record kept as one file into shards, at startup, until it is done.
     *
     * Only the runs that would be kept anyway are carried over: what lies before the last five
     * thousand would be deleted by the next shard opening, and reading it to delete it is what a
     * record grown to gigabytes cannot afford. So the tail is sharded and the file goes.
     *
     * Fewer than five thousand where the runs are fat enough that five thousand of them are more
     * than one read may take: the read stops on the last whole line inside its budget, and what it
     * did not reach goes with the file. That is the same bargain the five thousand is -- a record
     * has to fit somewhere -- struck against bytes rather than against runs, which is the measure
     * that means anything when what a run wrote has no length agreed in advance.
     *
     * Nothing here has to finish for the record to be safe, because none of it destroys anything
     * until all of it is written: the file goes last, and while it is there this runs again on every
     * start, off a file nothing has touched, and lays down the same runs under the same names. Which
     * is also why a file left beside a folder of shards is sharded again rather than simply deleted
     * -- the folder may hold nothing but the runs this process appended after a failure, and the two
     * cases cannot be told apart from outside.
     *
     * The newest shard is written first, so a failure part way leaves the newest runs readable and
     * the oldest waiting for the next start, rather than the other way about.
     *
     * A shard is named after the first run in it that can be read rather than simply its first line.
     * Half a line at a two hundred boundary would otherwise throw, and because this runs again on
     * every start off a file nothing has touched, that throw is not one failed migration but every
     * migration this record will ever get. The run the half line records is lost whatever is done
     * here; naming past it loses nothing further, since every run still readable in that shard
     * starts at or after the name it is given.
     */
    private static migrateHistory(id: string): void {
        const legacy = this.legacyHistoryFileOf(id);
        if (!FileUtils.exists(legacy)) {
            return;
        }
        try {
            const lines = FileUtils.readTailLines(legacy, HISTORY_SHARD_SIZE * HISTORY_SHARDS_KEPT);
            let written = 0;
            for (let from = lines.length; from > 0; from -= HISTORY_SHARD_SIZE) {
                const shard = lines.slice(Math.max(0, from - HISTORY_SHARD_SIZE), from);
                const firstStart = historiesIn(shard, legacy)[0]?.start;
                if (firstStart === undefined) {
                    logger.warn(`Left out a shard of cron task ${id} holding no readable run.`);
                    continue;
                }
                FileUtils.writeFile(
                    `${this.historyDirOf(id)}/${firstStart}.jsonl`, `${shard.join('\n')}\n`
                );
                written++;
            }
            FileUtils.deleteFile(legacy);
            this.dropOldestShards(id);
            logger.info(`Sharded the history of cron task ${id} into ${written} shards.`);
        } catch (error) {
            logger.error(`Failed to shard the history of cron task ${id}: ${error}`);
        }
    }

    private static saveTask(task: CronTask): void {
        try {
            const persisted: Omit<CronTask, 'histories' | 'nextRun'> = {
                id: task.id,
                title: task.title,
                creator: task.creator,
                cron: task.cron,
                prompt: task.prompt,
                paused: task.paused,
                closed: task.closed,
                lastRun: task.lastRun,
                usage: task.usage,
            };
            FileUtils.writeFile(`${CRON_DIR}/${task.id}/${CRON_TASK_JSON}`, JSON.stringify(persisted, null, 2));
        } catch (error) {
            logger.error(`Failed to save cron task ${task.id}: ${error}`);
        }
    }

    public static subscribe(subscriber: (task: UpdateContent<CronTask>) => void): () => void {
        this.subscribers.add(subscriber);
        return () => this.subscribers.delete(subscriber);
    }

    private static notify(task: UpdateContent<CronTask>): void {
        const record = {...task} as Record<string, unknown>;
        for (const key of Object.keys(task)) {
            if (task[key as keyof CronTask] === undefined) {
                record[key] = null;
            }
        }
        for (const subscriber of this.subscribers) {
            subscriber(record as UpdateContent<CronTask>);
        }
    }

}

export const CronService = globalize('CronService', CronServiceImpl);
CronService.loadCronTasks();
