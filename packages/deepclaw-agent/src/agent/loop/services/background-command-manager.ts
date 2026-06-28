import {runCommandAsync, FileUtils} from '@deepclaw/node-utils'
import { BACKGROUND_COMMANDS_DIR } from '../../paths';

type BackGroundCommandInfo = {
    id: string;
    title: string;
    preview?: string;
    outputPath?: string;
    status: 'running' | 'completed';
};

export type BackgroundCommand = BackGroundCommandInfo & {
    command: string;
    createdAt: string;
    completedAt?: string;
    output?: string;
    creator: string;
};

export class BackgroundCommandManager {
    private static completedCommands: Set<string> = new Set();
    private static commands: Map<string, BackgroundCommand> = new Map();

    public static runCommand(command: BackgroundCommand, sessionDir: string): void {
        const id = command.id;
        command.outputPath = `${sessionDir}/${BACKGROUND_COMMANDS_DIR}/${id}.bgout`;
        this.commands.set(id, command);
        runCommandAsync(command.command).then(({ output, preview }) => {
            command.output = output;
            command.preview = preview;
        }).catch((e) => {
            command.output = `Error: ${e?.message || 'Unknown error'}`;
            command.preview = command.output;
        }).finally(() => {
            this.completedCommands.add(id);
            command.completedAt = new Date().toISOString();
            command.status = 'completed';
            FileUtils.writeFile(command.outputPath!, command.output || '');
        });
    }

    public static getCommandStatus(commandId: string): BackGroundCommandInfo {
        const command = this.commands.get(commandId);
        if (!command) {
            throw new Error(`Command not found: ${commandId}`);
        }
        return {
            id: command.id,
            title: command.title,
            preview: command.preview,
            outputPath: command.outputPath,
            status: command.status
        };
    }

    public static getAllCommandsStatus(): BackGroundCommandInfo[] {
        const allCommands: BackGroundCommandInfo[] = [];
        for (const command of this.commands.values()) {
            allCommands.push({
                id: command.id,
                title: command.title,
                preview: command.preview,
                outputPath: command.outputPath,
                status: command.status
            });
        }
        return allCommands;
    }

    public static drainFinishedCommands(): BackGroundCommandInfo[] {
        const finishedCommands: BackGroundCommandInfo[] = [];
        for (const id of Array.from(this.completedCommands)) {
            finishedCommands.push(this.getCommandStatus(id));
        }
        this.completedCommands.clear();
        return finishedCommands;
    }
}
