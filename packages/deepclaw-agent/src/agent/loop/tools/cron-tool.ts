import type { CronJobHistory, LLMTaskOutput } from "@deepclaw/core";
import { FileStore } from "@deepclaw/node-utils";
import { OneLoopContext } from "../../definitions/definitions";
import { ToolDesc } from "../../definitions/tool-definitions";
import { CronService, MAX_DISPLAY_HISTORIES } from "../services/cron-service";
import { keptOutput, MAX_GENERATED_FILES, skippedFilesNote } from "../../loop-utils";

/** Where the report of a run stood in an answer that is not the one to ask for it. */
const OUTPUT_KEPT = '<Output kept, read it with get_cron_histories>';

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
 * runs and the way to the rest of them.
 */
const ANSWER_BUDGET = 12000;

/** The task as an answer to a write of it, with what its runs reported left out. */
function cronTaskAfterWrite(id: string): string {
    const cronTask = CronService.getCronTaskDetail(id);
    return JSON.stringify({
        ...cronTask,
        histories: cronTask.histories.map(history => history.output
            ? {...history, output: keptOutput(history.output, OUTPUT_KEPT)} : history),
    });
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
        description: 'Update the output of a cron task',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                id: {type: 'string'},
                output: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        type: {
                            type: 'string', enum: ['markdown', 'text', 'binary'],
                            description: 'Type of the cron task output.'
                        },
                        content: {
                            type: 'string',
                            description: `Content of the cron task output. Binary content should be base64 encoded.
For binary files and large text/md content, a file will be created on server, the content will be replaced as <Content saved to file> 
and the file path will be set into the path field.`
                        },
                        ext: {
                            type: 'string',
                            description: 'A proper extension for the file, e.g. "txt", "md", "pdf", "jpg", "png", "mp4", etc.'
                        },
                        generatedFiles: {
                            type: 'array',
                            items: {type: 'string'},
                            maxItems: MAX_GENERATED_FILES,
                            description: `The files this run produced, by their path in the workspace.
Each one is linked at the end of the content, so hand a file over here rather than writing its path
into the content: a path in a report is nothing the user can open. One written into the files folder
of this cron task is handed over as it lies, one from anywhere else is copied in there first.
A picture handed over this way is shown in the output rather than linked under it.
Only files inside the workspace can be handed over, and only files, not folders.`
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
    invoke: async function(input: UpdateCronOutputInput): Promise<string> {
        const {generatedFiles, ...output} = input.output;
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
                    description: 'Read the runs started before this time (epoch ms) instead of the latest ones, to walk further back than one answer reaches.'
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
        // The run that asks is a history of its own by then, and one that has nothing to report
        // until it records something. What it did record is its own to read back: a report long
        // enough to be filed is reachable no other way from inside the run that wrote it.
        const histories = CronService.getCronHistories(
            input.id, input.before || Number.MAX_SAFE_INTEGER, limit + 1
        ).filter(history => history.completed || history.output).slice(0, limit);
        if (!histories.length) {
            return 'This cron task has no finished run to read back.';
        }
        return answerOf(histories);
    },
}

/** As many of the runs as one answer carries, and where to read the ones it left for the next. */
function answerOf(histories: CronJobHistory[]): string {
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
    if (carried.length === histories.length) {
        return JSON.stringify(carried);
    }
    return `${JSON.stringify(carried)}
The runs before these were left out of this answer, read them with before: ${
    carried[carried.length - 1]!.start}.`;
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
