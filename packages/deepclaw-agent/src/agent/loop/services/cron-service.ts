import { CronJob } from 'cron';
import { addTokenUsage, type CronTask, type CronJobHistory, type LLMTaskOutput } from "@deepclaw/core";
import { saveToPublic } from '../../loop-utils';
import { CRON_DIR, CRON_HISTORY_JSONL, CRON_OUTPUT_DIR, CRON_TASK_JSON } from '../../paths';
import { FileUtils, UpdateContent, getLogger } from '@deepclaw/node-utils';
import { randomUUID } from 'node:crypto';
import { globalize } from '@deepclaw/utils';

const logger = getLogger('CronService');

export const MAX_DISPLAY_HISTORIES = 10;

export type CronScheduledJob = {
    job: CronJob;
    running: boolean;
}

class CronServiceImpl {
    private static subscribers: ((task: UpdateContent<CronTask>) => void)[] = [];
    private static cronTasks: Record<string, CronTask>;
    private static cronScheduledJob: Record<string, CronScheduledJob>;

    public static loadCronTasks(): void {
        if (!!this.cronTasks) return;
        this.cronTasks = {};
        this.cronScheduledJob = {};
        if (!FileUtils.exists(CRON_DIR)) {
            return;
        }
        const cronTaskFiles = FileUtils.readDir(CRON_DIR, dir => `${dir}/${CRON_TASK_JSON}`);
        for (const {dir, content} of Object.values(cronTaskFiles)) {
            try {
                const cronTask = JSON.parse(content) as CronTask;
                if (cronTask.closed) continue;
                this.cronTasks[cronTask.id] = cronTask;
                try {
                    const historyFile = `${CRON_DIR}/${cronTask.id}/${CRON_HISTORY_JSONL}`;
                    if (FileUtils.exists(historyFile)) {
                        const histories = FileUtils.readFile(historyFile).trim();
                        cronTask.histories = histories.split('\n').map(line => JSON.parse(line));
                    }
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
        this.scheduleCronTask(cronTask);
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
        cronTask.histories.push(history);
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
            FileUtils.appendFile(
                `${CRON_DIR}/${cronTask.id}/${CRON_HISTORY_JSONL}`, `${JSON.stringify(history)}\n`
            );
            FileUtils.deleteDir(loop.getSessionDir());
        } catch (error) {
            logger.error(`Failed to save cron task ${cronTask.id} history: ${error}`);
        } finally {
            job.running = false;
        }
    }

    public static updateCronTask(updateTask: {id: string; title?: string, cron?: string; prompt?: string}): CronTask {
        const task = this.getCronTask(updateTask.id);
        if (task.closed) {
            throw new Error(`Cannot update a closed task ${task.title}`);
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

    public static updateCronOutput(id: string, output: LLMTaskOutput): void {
        const cronTask = this.getCronTask(id);
        const history = cronTask.histories[cronTask.histories.length - 1];
        if (!history) {
            throw new Error('No history found for cron task.');
        }
        if (history.completed) {
            throw new Error('Cron task already completed.');
        }
        history.output = output;
        if (output) {
            saveToPublic(id, output, `${FileUtils.hashString(cronTask.title)}/${history.start}`, CRON_OUTPUT_DIR);
        }
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

    public static subscribe(subscriber: (task: UpdateContent<CronTask>) => void): void {
        this.subscribers.push(subscriber);
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
