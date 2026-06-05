import {runCommandAsync, FileUtils} from '@deepclaw/utils'

type BackGroundCommandInfo = {
    id: string;
    title: string;
    preview?: string;
    outputPath?: string;
    status: 'running' | 'completed';
};

export type BackgroundCommand = BackGroundCommandInfo & {
    command: string;
    projectId: string;
    taskTitle: string;
    createdAt: string;
    completedAt?: string;
    output?: string;
    creator: string;
};

const OUTPUT_DIR = '.projects/background_commands';

export class BackgroundCommandManager {
    private static completedCommands: string[] = [];
    private static commands: Map<string, BackgroundCommand> = new Map();
    
    public static runCommand(command: BackgroundCommand): void { 
        const id = command.id;
        command.outputPath = `${OUTPUT_DIR}/${command.projectId}/${command.taskTitle}/${id}.log`;
        this.commands.set(id, command);
        runCommandAsync(command.command).then(({ output, preview }) => {
            command.output = output;
            command.preview = preview;
        }).catch((e) => {
            command.output = `Error: ${e?.message || 'Unknown error'}`;
            command.preview = command.output;
        }).finally(() => {
            this.completedCommands.push(id);
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
        for (const id of this.completedCommands) {
            finishedCommands.push(this.getCommandStatus(id));
        }
        this.completedCommands = [];
        return finishedCommands;
    }
}