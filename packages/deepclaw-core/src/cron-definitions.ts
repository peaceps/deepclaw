import type { TokenUsage } from "./agent-definitions";
import type { Task } from "./project-definitions";

export type CronJobHistory = {
    start: string;
    completed?: string;
    output?: Task['output'];
    usage: TokenUsage;
    finalText?: string;
    success?: boolean;
}

export type CronTask = {
    id: string;
    title: string;
    creator: string;
    cron: string;
    prompt: string;
    paused?: boolean;
    closed?: boolean;
    lastRun?: string;
    nextRun?: string;
    histories: CronJobHistory[];
    usage: TokenUsage;
};
