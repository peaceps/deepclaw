import { CronJob } from 'cron';
import { Task } from "@deepclaw/core";
import { LoopInitializer } from '../../loop-initializer';

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

    public static createCronJob(cron: string, input: string) {
        const job = new CronJob(
            cron,
            function () {
                console.log('You will see this message every second');
            }, // onTick
            null, // onComplete
            true, // start
            Intl.DateTimeFormat().resolvedOptions().timeZone
        );
    }

}

