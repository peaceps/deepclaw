import crypto from 'crypto';
import { ToolDesc } from "../../definitions/tool-definitions";
import { BackgroundCommand, BackgroundCommandManager } from '../services/background-command-manager';
import { SessionService } from '../services/session-service';
import { OneLoopContext } from '../../definitions/definitions';
import { commandGuard } from './command-guard';

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
    // The same guard the command run in the foreground goes through. Left ungated, this tool is the
    // way around every rule of that one: the same shell, the same machine, only nobody asked.
    guard: (input: RunBackgroundCommandInput, context: OneLoopContext) => commandGuard(
        input.command, context
    ),
    invoke: async function(input: RunBackgroundCommandInput, context: OneLoopContext): Promise<string> {
        const { title, command } = input;
        const id = crypto.randomUUID();
        const backgroundCommand: BackgroundCommand = {
            id,
            command,
            title,
            createdAt: new Date().toISOString(),
            creator: context.loopId,
            status: 'running',
        };
        // Never the session dir of a sub loop: that folder is deleted the moment the sub loop
        // returns, while the command keeps running and still has to write its output somewhere.
        BackgroundCommandManager.runCommand(backgroundCommand, SessionService.getSessionDir(
            context.role, context.agentId, context.projectId
        ));
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
    invoke: async function(input: CheckBackgroundCommandStatusInput, context: OneLoopContext): Promise<string> {
        const { commandId } = input;
        const command = BackgroundCommandManager.getCommandStatus(commandId, context.loopId);
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
    invoke: async function(_input: void, context: OneLoopContext): Promise<string> {
        const commands = BackgroundCommandManager.getAllCommandsStatus(context.loopId);
        let response = `All background commands status:
${JSON.stringify(commands)}`;
        return response;
    }

}

type RemoveBackgroundCommandInput = {
    commandId: string;
};

export const removeBackgroundCommand: ToolDesc<RemoveBackgroundCommandInput> = {
    tool: {
        name: 'remove_background_command',
        description: 'Remove the background task record after it is done and output consumed.',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                commandId: {
                    type: 'string',
                    description: 'The ID of the background command to remove.',
                }
            },
            required: ['commandId'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: true,
    invoke: async function(input: RemoveBackgroundCommandInput, context: OneLoopContext): Promise<string> {
        const { commandId } = input;
        const command = BackgroundCommandManager.getCommandStatus(commandId, context.loopId);
        if (command.status === 'running') {
            return `Command ${commandId} is running, cannot remove.`;
        }
        BackgroundCommandManager.removeCommand(commandId, context.loopId);
        return `Command "${commandId}" is removed`;
    }
}
