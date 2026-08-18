import type { LLMTaskOutput } from "@deepclaw/core";
import { OneLoopContext } from "../../definitions/definitions";
import { ToolDesc } from "../../definitions/tool-definitions";
import { CronService, MAX_DISPLAY_HISTORIES } from "../services/cron-service";
import { keptOutput, MAX_GENERATED_FILES, skippedFilesNote } from "../../loop-utils";

/**
 * Where the report of a run stood in an answer that is not the one to ask for it. It names no way
 * to read it back because there is none: a run records its output as it ends, and what the runs
 * before it recorded goes to the user rather than to the next run.
 */
const OUTPUT_KEPT = '<Output kept>';

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
