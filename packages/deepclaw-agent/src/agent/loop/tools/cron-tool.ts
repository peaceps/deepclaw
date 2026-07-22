import { Task } from "@deepclaw/core";
import { OneLoopContext, ToolDesc } from "../../..";
import { CronService } from "../services/cron-service";

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
    parallelSafe: false,
    agentMode: ['agent'],
    exclusiveInSubLoop: true,
    invoke: async function(input: CreateCronTaskInput, context: OneLoopContext): Promise<string> {
        const {title, cron, prompt} = input;
        const cronTask = CronService.createCronTask(title, context.agentId, cron, prompt);
        return `Cron task created successfully, here\'s the detail:
${JSON.stringify(CronService.getCronTaskDetail(cronTask.id))}`;
    },
}

type UpdateCronOutputInput = {
    id: string;
    output: Task['output'];
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
                        }
                    },
                    required: ['type', 'content'],
                }
            },
            required: ['id', 'output'],
        },
    },
    parallelSafe: false,
    agentMode: ['agent'],
    exclusiveInSubLoop: true,
    invoke: async function(input: UpdateCronOutputInput): Promise<string> {
        const {id, output} = input;
        CronService.updateCronOutput(id, output);
        return `Cron output updated successfully, here\'s the detail:
${JSON.stringify(CronService.getCronTaskDetail(id))}`;
    },
}
