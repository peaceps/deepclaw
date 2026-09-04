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

/** Worded for the model that started the command and comes back for it a run later. */
const STOPPED_OUTPUT = 'The user stopped the run that started this command, so it did not finish.';

export class BackgroundCommandManager {
    private static commands: Map<string, BackgroundCommand> = new Map();

    /**
     * A command started here outlives the turn that started it, which is the whole of what it is
     * for, but not a stop of the run that started it: what a stop leaves running is work nobody is
     * coming back for. The signal is that run's and nothing else fires it, so the commands of the
     * runs before this one keep going, theirs belonging to a run that is already over.
     */
    public static runCommand(
        command: BackgroundCommand, sessionDir: string, signal?: AbortSignal, cwd?: string
    ): void {
        const id = command.id;
        command.outputPath = `${sessionDir}/${BACKGROUND_COMMANDS_DIR}/${id}.bgout`;
        this.commands.set(id, command);
        // Started where the run that asked for it works, the same as one run in the foreground: the
        // two are the same shell on the same machine, and a command that means one folder when it
        // is waited on and another when it is not is the worst of both.
        runCommandAsync(command.command, signal, cwd).then(({ output, preview }) => {
            command.output = output;
            command.preview = preview;
        }).catch((e) => {
            // Read back as a stop rather than as a failure: a model told a command of its own broke
            // will start it again, or set about explaining a fault that never happened.
            command.output = signal?.aborted ? STOPPED_OUTPUT
                : `Error: ${e?.message || 'Unknown error'}`;
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
