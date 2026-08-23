import type { CronJobHistory, LLMTaskOutput } from "@deepclaw/core";
import { FileStore } from "@deepclaw/node-utils";
import { OneLoopContext } from "../../definitions/definitions";
import { ToolDesc } from "../../definitions/tool-definitions";
import { CronService, MAX_DISPLAY_HISTORIES } from "../services/cron-service";
import {
    EXT_DESCRIPTION, keptOutput, MAX_GENERATED_FILES, requireReadableOutput, skippedFilesNote,
    TRUNCATE_THRESHOLD
} from "../../loop-utils";

/** Where the report of a run stood in an answer that is not the one to ask for it. */
const OUTPUT_KEPT = '<Output kept, read it with get_cron_histories>';

/** Where the words of a run stood, once they were more than an answer about the task carries. */
const REPORT_KEPT = '<Report kept, read it with get_cron_histories>';

/** How many runs are read back for a caller that does not say, out of a record of any length. */
const HISTORIES_READ = 3;

/**
 * How many runs one call may ask for, however long the record of the task is. What a page of the
 * ui holds is a question of its own, and the reports of this many runs are already more than the
 * work of one run tends to stand on.
 */
export const HISTORIES_READ_MAX = 5;

/**
 * How much of an answer the reports of the runs may fill. A report is as long as the run made it,
 * so how many of them fit is nothing a count of runs can say: past what an answer holds, the whole
 * of it is filed away and comes back as a preview and a path, which is a worse answer than fewer
 * runs and the way to the rest of them. So the budget is a part of what an answer holds, and what
 * it leaves is room for the one report that is carried whatever its length: no room is enough for
 * any length, and the room there is buys the reports that are merely long an answer of their own.
 */
const ANSWER_BUDGET = TRUNCATE_THRESHOLD * 0.6;

/**
 * How much of what a run said of itself an answer about the task carries. As many runs stand in
 * such an answer as the record shows, each of them as talkative as it liked, so the share of one is
 * the budget of a read split that many ways: a run signing off in a line is carried as it stands.
 */
const REPORT_KEPT_LENGTH = ANSWER_BUDGET / MAX_DISPLAY_HISTORIES;

/** The task as an answer to a write of it, with what its runs reported left out. */
function cronTaskAfterWrite(id: string): string {
    const cronTask = CronService.getCronTaskDetail(id);
    return JSON.stringify({...cronTask, histories: cronTask.histories.map(historyAfterWrite)});
}

/**
 * A run of the task as it stands in an answer about the task. What it reported is read with the tool
 * for reading it, here as much as anywhere else: an answer that carried the words of every run in
 * the record would be filed away whole and come back as a preview of itself.
 */
function historyAfterWrite(history: CronJobHistory): CronJobHistory {
    const kept = {...history};
    if (kept.output) {
        kept.output = keptOutput(kept.output, OUTPUT_KEPT);
    }
    if (kept.finalText && kept.finalText.length > REPORT_KEPT_LENGTH) {
        kept.finalText = REPORT_KEPT;
    }
    return kept;
}

type CreateCronTaskInput = {
    title: string;
    cron: string;
    prompt: string;
}

export const createCronTaskTool: ToolDesc<CreateCronTaskInput> = {
    tool: {
        name: 'create_cron_task',
        description: 'Create a new cron task',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                title: {type: 'string', description: 'The title of the cron task'},
                cron: {type: 'string', description: 'The cron expression of the cron task, e.g. "0 0 * * *" for daily at midnight'},
                prompt: {type: 'string', description: 'The prompt of the cron task'},
            },
            required: ['title', 'cron', 'prompt'],
        },
    },
    parallelSafe: true,
    agentMode: ['agent'],
    loopKinds: ['main'],
    invoke: async function(input: CreateCronTaskInput, context: OneLoopContext): Promise<string> {
        const {title, cron, prompt} = input;
        const cronTask = CronService.createCronTask(title, context.agentId, cron, prompt);
        return `Cron task created successfully, here\'s the detail:
${cronTaskAfterWrite(cronTask.id)}`;
    },
}

type UpdateCronTaskInput = {
    id: string;
    title?: string;
    cron?: string;
    prompt?: string;
}

export const updateCronTaskTool: ToolDesc<UpdateCronTaskInput> = {
    tool: {
        name: 'update_cron_task',
        description: 'Update an existing cron task',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                id: {type: 'string', description: 'The id of the cron task'},
                title: {type: 'string', description: 'The title of the cron task'},
                cron: {type: 'string', description: 'The cron expression of the cron task, e.g. "0 0 * * *" for daily at midnight'},
                prompt: {type: 'string', description: 'The prompt of the cron task'},
            },
            required: ['id'],
        },
    },
    parallelSafe: true,
    agentMode: ['agent'],
    loopKinds: ['main'],
    invoke: async function(input: UpdateCronTaskInput): Promise<string> {
        const cronTask = CronService.updateCronTask(input);
        return `Cron task updated successfully, here\'s the detail:
${cronTaskAfterWrite(cronTask.id)}`;
    },
}

type UpdateCronOutputInput = {
    id: string;
    /** generatedFiles names what to hand over to the user, it is no part of the kept output. */
    output: LLMTaskOutput & {generatedFiles?: string[]};
};

export const updateCronOutputTool: ToolDesc<UpdateCronOutputInput> = {
    tool: {
        name: 'update_cron_output',
        description: `Record the result of this scheduled run: it is what the user reads of the run
later, and all that is left of it once the run ends.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                id: {
                    type: 'string',
                    description: 'The id of the cron task, the one named in Current Cron Task.'
                },
                output: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        type: {
                            type: 'string', enum: ['markdown', 'text'],
                            description: 'Type of the cron task output.'
                        },
                        content: {
                            type: 'string',
                            description: `Content of the cron task output, what the user reads of
this run. Large content is filed away into a file of its own, so there is no size to work around.
A file this run produced goes in generatedFiles rather than in here as its bytes.`
                        },
                        ext: {type: 'string', description: EXT_DESCRIPTION},
                        generatedFiles: {
                            type: 'array',
                            items: {type: 'string'},
                            maxItems: MAX_GENERATED_FILES,
                            description: `The files this run produced, by their path in the
workspace, each linked at the end of the content: a path written into the content itself is nothing
the user can open. One in the files folder of this cron task is handed over as it lies, one from
anywhere else is copied in there first. A picture is shown in the output rather than linked under
it. Only files, not folders, and only inside the workspace.`
                        }
                    },
                    required: ['type', 'content'],
                }
            },
            required: ['id', 'output'],
        },
    },
    parallelSafe: true,
    agentMode: ['agent'],
    loopKinds: ['main'],
    // What this writes is the result of the run doing the writing, so only a run that is one has
    // anything to say here. Anywhere else it is a tool for filing a report on somebody else's work.
    roles: ['cron'],
    invoke: async function(input: UpdateCronOutputInput): Promise<string> {
        const {generatedFiles, ...output} = input.output;
        requireReadableOutput(output);
        const {skipped} = CronService.updateCronOutput(input.id, output, generatedFiles);
        return `Cron output updated successfully, here\'s the detail with last max ${MAX_DISPLAY_HISTORIES} histories:
${cronTaskAfterWrite(input.id)}${skippedFilesNote(skipped)}`;
    },
}

type GetCronHistoriesInput = {
    id: string;
    limit?: number;
    before?: number;
};

export const getCronHistoriesTool: ToolDesc<GetCronHistoriesInput> = {
    tool: {
        name: 'get_cron_histories',
        description: `Read what the earlier runs of a cron task reported, the newest one first.
This is the only way a run hears of the ones before it: every run starts from the prompt of the task
and nothing else, so read the earlier reports whenever the work builds on them, as a digest of what
changed does. A report too long to be kept in the record lies in a file of its own, named in "file"
and read from there.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                id: {type: 'string', description: 'The id of the cron task'},
                limit: {
                    type: 'number',
                    description: `How many runs to read back, ${HISTORIES_READ} by default and ${HISTORIES_READ_MAX} at most. A run that reported at length fills an answer by itself, so ask for the runs the work needs: fewer than asked for may come back, with the time to read the rest from.`
                },
                before: {
                    type: 'number',
                    description: 'Read the runs started before this time (epoch ms) instead of the latest ones, to walk further back than one answer reaches. A run started at this very time is not read back, so the start of the oldest run of an answer reads the ones before it and no run twice.'
                },
            },
            required: ['id'],
        },
    },
    parallelSafe: true,
    agentMode: ['agent'],
    loopKinds: ['main'],
    invoke: async function(input: GetCronHistoriesInput): Promise<string> {
        const limit = Math.min(Math.max(input.limit || HISTORIES_READ, 1), HISTORIES_READ_MAX);
        // One run more than was wanted is asked of the record, and whether it came is what says the
        // record goes on: counting what is left after filtering and cutting to size cannot say it,
        // there a run held back for reporting nothing looks like a run that was never in the record.
        // Held back out of a window that came back full it reads as one run further back than it is,
        // and the way on may lead to nothing: a call spent for an empty answer, which is the side to
        // be wrong on. An end read into a record that goes on is read once and believed.
        const found = CronService.getCronHistories(
            input.id, input.before || Number.MAX_SAFE_INTEGER, limit + 1
        );
        // The run that asks is a history of its own by then, and one that has nothing to report
        // until it records something. What it did record is its own to read back: a report long
        // enough to be filed is reachable no other way from inside the run that wrote it.
        const histories = found
            .filter(history => history.completed || history.output).slice(0, limit);
        if (!histories.length) {
            // A window of runs that all died mid way is no end of the record either, and the run
            // that reported is further back than this call reached.
            return found.length > limit
                ? `No run in this window reported anything, read further back with before: ${
                    found[found.length - 1]!.start}`
                : 'This cron task has no finished run to read back.';
        }
        return answerOf(histories, found.length > limit);
    },
}

/**
 * As many of the runs as one answer carries, and where to read the ones it left for the next. The
 * way further back is named for a run the budget dropped as much as for one the record still holds
 * beyond this answer, and named nowhere else: a caller that reads no way on has read the record out.
 */
function answerOf(histories: CronJobHistory[], goesOn: boolean): string {
    const carried: (CronJobHistory | ReadableHistory)[] = [];
    let size = 0;
    for (const history of histories) {
        const one = readable(history);
        const length = JSON.stringify(one).length;
        // The first run asked about is carried however long it reported, or nothing is read at all.
        if (carried.length && size + length > ANSWER_BUDGET) {
            break;
        }
        carried.push(one);
        size += length;
    }
    if (carried.length === histories.length && !goesOn) {
        return JSON.stringify(carried);
    }
    // The time stands at the end of the sentence, where nothing of the sentence can be copied into
    // the parameter along with it.
    return `${JSON.stringify(carried)}
The runs before these are in no answer of this call, read them with before: ${
    carried[carried.length - 1]!.start}`;
}

/**
 * A run of the task as another run can use it. The report of one too long to be kept in the record
 * lies in a file, and what stands in the record is the link the user opens it by: a route of the
 * app is nothing an agent can fetch, the file it serves is right there to be read.
 */
function readable(history: CronJobHistory): CronJobHistory | ReadableHistory {
    const file = !history.output?.path ? null : FileStore.fileOf(history.output.path);
    if (!file) {
        return history;
    }
    const output: ReadableOutput = {...history.output!, file};
    delete output.path;
    return {...history, output};
}

type ReadableOutput = NonNullable<LLMTaskOutput> & {file: string};
type ReadableHistory = Omit<CronJobHistory, 'output'> & {output: ReadableOutput};
