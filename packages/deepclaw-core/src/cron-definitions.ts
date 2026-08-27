import type { TokenUsage } from "./agent-definitions";
import type { LLMTaskOutput } from "./flush-agent-types";

/**
 * How many runs of a task a browser is shown at once, on the first screen and on a page back alike.
 *
 * It lives out here because it is one number two sides have to agree on: the server cuts what it
 * pushes and what it answers a page with to this, and the browser reads a page shorter than this as
 * the record having run out. A second copy of it in the ui is a first screen and a page back of
 * different sizes, and a page that comes back full read as the end of the record.
 */
export const MAX_DISPLAY_HISTORIES = 20;

export type CronJobHistory = {
    start: number;
    completed?: number;
    output?: LLMTaskOutput;
    usage: TokenUsage;
    finalText?: string;
    status: 'running' | 'success' | 'failed';
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
