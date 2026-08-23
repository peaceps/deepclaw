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
    /** The loopId that started the command. Sub loops share it with their parent on purpose:
     *  a command usually outlives the sub loop and its result belongs to the loop that remains. */
    creator: string;
    /** Set once the loop that started the command has been told that it finished. */
    reported?: boolean;
};

export class BackgroundCommandManager {
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
            command.completedAt = new Date().toISOString();
            command.status = 'completed';
            const outputPath = FileUtils.writeFile(command.outputPath!, command.output || '');
            command.outputPath = outputPath;
        });
    }

    public static getCommandStatus(commandId: string, creator: string): BackGroundCommandInfo {
        return this.statusOf(this.ownedCommand(commandId, creator));
    }

    public static removeCommand(commandId: string, creator: string): void {
        const command = this.commands.get(commandId);
        if (!command || command.creator !== creator) {
            return;
        }
        this.commands.delete(commandId);
        if (command.outputPath) {
            FileUtils.deleteFile(command.outputPath);
        }
    }

    /**
     * Whether a command of this loop is still running, which is to say still writing into the
     * session folder. A loop being idle says nothing about it: outliving the turn that started it
     * is what a background command is for.
     */
    public static hasRunningCommand(creator: string): boolean {
        return Array.from(this.commands.values())
            .some(command => command.creator === creator && command.status === 'running');
    }

    public static getAllCommandsStatus(creator: string): BackGroundCommandInfo[] {
        return Array.from(this.commands.values())
            .filter(command => command.creator === creator)
            .map(command => this.statusOf(command));
    }

    /**
     * Whether a finish was already reported is remembered on the command itself, so a result
     * nobody ever came back for is forgotten together with the command instead of outliving it.
     */
    public static drainFinishedCommands(creator: string): BackGroundCommandInfo[] {
        const finishedCommands: BackGroundCommandInfo[] = [];
        for (const command of this.commands.values()) {
            if (command.creator !== creator || command.status !== 'completed' || command.reported) {
                continue;
            }
            command.reported = true;
            finishedCommands.push(this.statusOf(command));
        }
        return finishedCommands;
    }

    /** A command of another loop is reported as missing rather than as forbidden. */
    private static ownedCommand(commandId: string, creator: string): BackgroundCommand {
        const command = this.commands.get(commandId);
        if (!command || command.creator !== creator) {
            throw new Error(`Command not found: ${commandId}`);
        }
        return command;
    }

    private static statusOf(command: BackgroundCommand): BackGroundCommandInfo {
        return {
            id: command.id,
            title: command.title,
            preview: command.preview,
            outputPath: command.outputPath,
            status: command.status
        };
    }
}
