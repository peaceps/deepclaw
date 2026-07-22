import { CronJob } from 'cron';
import { Task, TokenUsage } from "@deepclaw/core";
import { LoopInitializer } from '../../loop-initializer';
import { saveToPublic } from '../../loop-utils';
import { CRON_DIR, CRON_OUTPUT_DIR } from '../../paths';
import { FileUtils } from '@deepclaw/node-utils';
import { randomUUID } from 'node:crypto';
import { getLogger } from '@deepclaw/node-utils';

const logger = getLogger('CronService');

export type CronJobHistory = {
    start: string;
    completed?: string;
    output?: Task['output'];
    usage?: TokenUsage;
    finalText?: string;
}

export type CronTask = {
    id: string;
    title: string;
    creator: string;
    cron: string;
    prompt: string;
    paused?: boolean;
    closed?: boolean;
    histories: CronJobHistory[];
};

export type CronScheduledJob = {
    job: CronJob;
    running: boolean;
}

export class CronService {
    private static cronTasks: Record<string, CronTask> = {};
    private static cronScheduledJob: Record<string, CronScheduledJob> = {};

    static {this.loadCronTasks();}

    private static loadCronTasks(): void {
        if (!FileUtils.exists(CRON_DIR)) return;
        const cronTaskFiles = FileUtils.readDir(CRON_DIR, dir => `${dir}/cron.json`);
        for (const {dir, content} of Object.values(cronTaskFiles)) {
            try {
                const cronTask = JSON.parse(content) as CronTask;
                if (cronTask.closed) continue;
                this.cronTasks[cronTask.id] = cronTask;
                try {
                    const historyFile = `${CRON_DIR}/${cronTask.id}/history.jsonl`;
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
            histories: [],
        };
        this.cronTasks[id] = cronTask;
        FileUtils.writeFile(
            `${CRON_DIR}/${id}/cron.json`, JSON.stringify(cronTask, null, 2)
        );
        this.scheduleCronTask(cronTask)
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
        const loop = LoopInitializer.getLoop('cron', cronTask.creator, cronTask.id, {
            onStreamText: () => {},
            onInteractionEvent: () => Promise.resolve(''),
            onInfoEvent: () => {}
        });
        const history: CronJobHistory = {
            start: new Date().toISOString(),
        };
        cronTask.histories.push(history);
        
        try {
            const {text, runtime} = await loop.invoke(cronTask.prompt, {browserId: ''});
            history.finalText = text;
            history.usage = runtime.usage;
        } catch (error) {
            const text = `Failed to run cron task ${cronTask.id}: ${error}`;
            history.finalText = text;
        }
        history.completed = new Date().toISOString();
        try {
            FileUtils.appendFile(
                `${CRON_DIR}/${cronTask.id}/history.jsonl`, `${JSON.stringify(history)}\n`
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
        if (output) {
            saveToPublic(id, output, cronTask.title, CRON_OUTPUT_DIR);
        }
    }

    private static getCronTask(id: string): CronTask {
        const cronTask = this.cronTasks[id];
        if (!cronTask) {
            throw new Error('Cron task not found.');
        }
        return cronTask;
    }

    public static getCronTaskDetail(id: string): Partial<CronTask> {
        const cronTask = this.getCronTask(id);
        return {
            id: cronTask.id,
            title: cronTask.title,
            creator: cronTask.creator,
            cron: cronTask.cron,
            paused: cronTask.paused,
            closed: cronTask.closed,
            histories: cronTask.histories.map(history => ({
                start: history.start,
                completed: history.completed,
                output: history.output,
            })),
        };
    }

}
