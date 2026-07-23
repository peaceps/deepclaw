import { CronJob } from 'cron';
import { addTokenUsage, Task, type CronTask, type CronJobHistory } from "@deepclaw/core";
import { saveToPublic } from '../../loop-utils';
import { CRON_DIR, CRON_HISTORY_JSONL, CRON_OUTPUT_DIR, CRON_TASK_JSON } from '../../paths';
import { FileUtils, UpdateContent } from '@deepclaw/node-utils';
import { randomUUID } from 'node:crypto';
import { getLogger } from '@deepclaw/node-utils';

const logger = getLogger('CronService');

export const MAX_DISPLAY_HISTORIES = 10;

export type CronScheduledJob = {
    job: CronJob;
    running: boolean;
}

export class CronService {
    private static subscribers: ((task: UpdateContent<CronTask>) => void)[] = [];
    private static cronTasks: Record<string, CronTask> = {};
    private static cronScheduledJob: Record<string, CronScheduledJob> = {};

    static {this.loadCronTasks();}

    private static loadCronTasks(): void {
        if (!FileUtils.exists(CRON_DIR)) return;
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
            start: new Date().toISOString(),
            usage: {
                cachedInputTokens: 0,
                noCachedInputTokens: 0,
                outputTokens: 0,
            },
        };
        cronTask.histories.push(history);
        cronTask.lastRun = history.start;
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
            history.success = runtime.transitionReason !== 'error';
        } catch (error) {
            const text = `Failed to run cron task ${cronTask.id}: ${error}`;
            history.success = false;
            history.finalText = text;
        }
        history.completed = new Date().toISOString();
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

    public static updateCronOutput(id: string, output: Task['output']): void {
        const cronTask = this.getCronTask(id);
        const history = cronTask.histories[cronTask.histories.length - 1];
        if (!history) {
            throw new Error('No history found for cron task.');
        }
        if (history.completed) {
            throw new Error('Cron task already completed.');
        }
        history.output = output;
        this.notify({
            id: cronTask.id,
            histories: cronTask.histories.slice(-MAX_DISPLAY_HISTORIES),
        });
        if (output) {
            saveToPublic(id, output, cronTask.title, CRON_OUTPUT_DIR);
        }
    }

    public static updateCronTaskStatus({id, pause, close}: {id: string, pause?: boolean; close?: boolean}) {
        const job = this.cronScheduledJob[id];
        const task = this.getCronTask(id);
        if (close) {
            if (job) {
                job.job.stop();
            }
            delete this.cronScheduledJob[id];
            task.closed = true;
            task.paused = true;
            task.nextRun = undefined;
            delete this.cronTasks[id];
        } else {
            task.paused = pause;
            if (job && pause) {
                job.job.stop();
                delete this.cronScheduledJob[id];
                task.nextRun = undefined;
            } else if (!pause && !job) {
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
        for (const subscriber of this.subscribers) {
            subscriber(task);
        }
    }

}
