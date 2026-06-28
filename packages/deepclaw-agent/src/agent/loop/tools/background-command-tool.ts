import crypto from 'crypto';
import { ToolDesc } from "../../definitions/tool-definitions";
import { BackgroundCommand, BackgroundCommandManager } from '../services/background-command-manager';
import { OneLoopContext } from '../../definitions/definitions';

type RunBackgroundCommandInput = {
    title: string;
    command: string;
};

export const runBackgroundCommandTool: ToolDesc<RunBackgroundCommandInput> = {
    tool: {
        name: 'run_background_command',
        description: `Run a command in an separated process in background. The tool will return immediately with an ID,
and the agent can check the result of the background command later.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                title: {
                    type: 'string',
                    description: 'The title of the background command, will display to the user.',
                    minLength: 1,
                    maxLength: 50,
                },
                command: {
                    type: 'string',
                    description: 'The command to run in background.',
                },
            },
            required: ['title', 'command'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: true,
    exclusiveInSubLoop: false,
    invoke: async function(input: RunBackgroundCommandInput, context: OneLoopContext): Promise<string> {
        const { title, command } = input;
        const id = crypto.randomUUID();
        const backgroundCommand: BackgroundCommand = {
            id,
            command,
            title,
            createdAt: new Date().toISOString(),
            creator: 'main',
            status: 'running',
        };
        BackgroundCommandManager.runCommand(backgroundCommand, context.sessionDir);
        return `Background command "${title}" created with ID: ${id} starts to run. You can check the status of this command later with check_background_command_status tool.`;
    }
}

type CheckBackgroundCommandStatusInput = {
    commandId: string;
};

export const checkBackgroundCommandStatusTool: ToolDesc<CheckBackgroundCommandStatusInput> = {
    tool: {
        name: 'check_background_command_status',
        description: 'Check the status of a background command.',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                commandId: {
                    type: 'string',
                    description: 'The ID of the background command to check.',
                }
            },
            required: ['commandId'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: true,
    exclusiveInSubLoop: false,
    invoke: async function(input: CheckBackgroundCommandStatusInput): Promise<string> {
        const { commandId } = input;
        const command = BackgroundCommandManager.getCommandStatus(commandId);
        return `Command "${command.title}" is currently ${command.status}. 
Detailed Info: ${JSON.stringify(command)}`;
    }
}

export const checkAllBackgroundCommandStatusTool: ToolDesc<void> = {
    tool: {
        name: 'check_all_background_command_status',
        description: 'Check the status of all background commands.',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
            },
            required: [],
        },
    },
    agentMode: ['agent'],
    parallelSafe: true,
    exclusiveInSubLoop: false,
    invoke: async function(): Promise<string> {
        const commands = BackgroundCommandManager.getAllCommandsStatus();
        let response = `All background commands status:
${JSON.stringify(commands)}`;
        return response;
    }

}