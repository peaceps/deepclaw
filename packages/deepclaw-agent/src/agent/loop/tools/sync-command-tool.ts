import { i18nInstance } from '@deepclaw/i18n';
import { runCommand, childProcessTimeout} from '@deepclaw/node-utils';
import { ToolDesc } from '../../definitions/tool-definitions';
import { isRunStopped, OneLoopContext } from '../../definitions/definitions';
import { commandGuard } from './command-guard';

type SyncCommandInput = {
    command: string;
}

export const syncCommandTool: ToolDesc<SyncCommandInput> = {
    tool: {
        name: 'run_sync_command',
        description: `Run a command such as a shell command in the current workspace in a child process.
Will return the output of the command. This is local function tool, not MCP compatible.`,
        schema: {
            type: 'object' as const,
            additionalProperties: false,
            properties: {command: {type: 'string'}},
            required: ['command'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: false,
    invoke: execute,
    guard: (input: SyncCommandInput, context: OneLoopContext) => commandGuard(input.command, context),
}

async function execute(input: SyncCommandInput, context: OneLoopContext): Promise<string> {
    const { command } = input;
    try {
        // The whole of the output rather than the preview of it. An answer over the limit is filed
        // away and comes back as a path, and a preview is cut to that very limit, so handing one
        // over lands just under the line every time: nothing is filed, nothing says a cut happened,
        // and the tail of a long output is gone with no way left to ask for it.
        const { output } = await runCommand(command, context.abortSignal);
        return !output ? i18nInstance.t('agent.tools.syncCommand.empty'): output;
    } catch (error: any) {
        // A stopped command is killed with the very signal a command out of time is killed with,
        // so what happened is read off the run rather than off the error. Told it timed out, the
        // model would report two minutes that never passed and go looking for a command to blame.
        if (isRunStopped(context)) {
            return i18nInstance.t('agent.tools.syncCommand.stopped');
        }
        return error?.killed && error?.signal === 'SIGTERM' ? i18nInstance.t('agent.tools.syncCommand.timeout', {childProcessTimeout})
            : i18nInstance.t('agent.tools.syncCommand.error', {message: error?.message || ''});
    }
}
