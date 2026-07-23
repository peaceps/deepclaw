import type { TokenUsage } from "./agent-definitions";
import type { LLMTaskOutput } from "./flush-agent-types";

export type CronJobHistory = {
    start: number;
    completed?: number;
    output?: LLMTaskOutput;
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
