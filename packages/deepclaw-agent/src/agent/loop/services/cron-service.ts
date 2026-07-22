import { CronJob } from 'cron';
import { Task } from "@deepclaw/core";

export type CronJobExecution = {
    start: number;
    completed?: number;
    report: Task['output'];
}

export type CronTask = {
    id: string;
    title: string;
    creator: string;
    cron: string;
    prompt: string;
    histories: CronJobExecution[];
};

export class CronService {
    private static cronJobs: Record<string, CronTask> = {};

    public static createCronJob(cronTask: CronTask) {
        new CronJob(
            cronTask.cron,
            function () {
                console.log('You will see this message every second');
            }, // onTick
            null, // onComplete
            true, // start
            Intl.DateTimeFormat().resolvedOptions().timeZone
        );
        this.cronJobs[cronTask.id] = cronTask;
    }

    public static getCronJob(id: string): CronTask {
        const cronJob = this.cronJobs[id];
        if (!cronJob) {
            throw new Error('Cron job not found.');
        }
        return cronJob;
    }

}
