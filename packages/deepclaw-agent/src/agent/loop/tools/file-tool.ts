import { DEFAULT_LOOP_KINDS, ToolDesc, ToolGuardResult } from '../../definitions/tool-definitions';
import { i18nInstance } from '@deepclaw/i18n';
import { FileUtils } from '@deepclaw/node-utils';
import { PermissionService } from '../services/permission-service';
import { inRunWorkspace, runPath } from '../run-dir';
import {
    EDIT_FILE_FOOT_PRINT, OneLoopContext, READ_FILE_FOOT_PRINT, WRITE_FILE_FOOT_PRINT
} from '../../definitions/definitions';

type FileOperationInput = {
    filePath: string;
}

type ReadFileInput = FileOperationInput & {
    limit?: number;
}

export const readFileTool: ToolDesc<ReadFileInput> = {
    tool: {
        name: 'read_file',
        description: 'Read file contents.',
        schema: {
            type: 'object',
             properties: {
                filePath: {type: 'string'},
                limit: {type: 'integer', minimum: 1}
            },
            required: ['filePath']
        },
    },
    agentMode: ['agent'],
    parallelSafe: true,
    // A review reads, and this is the reading. Named rather than left to the default set, which a
    // review is kept out of: what it may reach for, it was handed one tool at a time.
    loopKinds: [...DEFAULT_LOOP_KINDS, 'review'],
    invoke: async function(input: ReadFileInput, context: OneLoopContext): Promise<string> {
        const { filePath, limit } = input;
        if (limit !== undefined && limit < 1) {
            throw new Error('The limit has to be at least one character.');
        }
        const content = FileUtils.readFile(runPath(context, filePath));
        // After the read rather than before it. What the trace tells a summarizer is that the run
        // has this file in hand already; a path that could not be opened is one the model would be
        // sent back to for content that was never there. A limited read is left in for the
        // opposite reason: it saw the file and holds only part of it, which is exactly the case
        // the trace exists to point at.
        context.actions.addFootPrint({type: READ_FILE_FOOT_PRINT, content: filePath});
        if (limit) {
            return content.slice(0, limit);
        }
        return content;
    },
    guard: fileGuard
}

type WriteFileInput = FileOperationInput & {
    content: string;
}

export const writeFileTool: ToolDesc<WriteFileInput> = {
    tool: {
        name: 'write_file',
        description: 'Write content to file.',
        schema: {
            type: 'object',
            properties: {
                filePath: {type: 'string'},
                content: {type: 'string'}
            },
            required: ['filePath', 'content']
        },
    },
    agentMode: ['agent'],
    parallelSafe: true,
    invoke: async function(input: WriteFileInput, context: OneLoopContext): Promise<string> {
        const { filePath, content } = input;
        FileUtils.writeFile(runPath(context, filePath), content);
        context.actions.addFootPrint({type: WRITE_FILE_FOOT_PRINT, content: filePath});
        return i18nInstance.t('agent.tools.file.write', {path: filePath, length: content.length});
    },
    guard: fileGuard
}

type EditFileInput = FileOperationInput & {
    oldText: string;
    newText: string;
}

export const editFileTool: ToolDesc<EditFileInput> = {
    tool: {
        name: 'edit_file',
        description: 'Replace exact text in file.',
        schema: {
            type: 'object',
            properties: {
                filePath: {type: 'string'},
                oldText: {type: 'string'},
                newText: {type: 'string'},
            },
            required: ['filePath', 'oldText', 'newText']
        },
    },
    agentMode: ['agent'],
    parallelSafe: true,
    invoke: async function(input: EditFileInput, context: OneLoopContext): Promise<string> {
        const { filePath, oldText, newText } = input;
        // Read and written as the one path: an edit that wrote a file other than the one it read
        // would drop everything in the file it wrote and leave the file it read as it was.
        const file = runPath(context, filePath);
        const content = FileUtils.readFile(file);
        const newContent = content.replaceAll(oldText, newText);
        FileUtils.writeFile(file, newContent);
        context.actions.addFootPrint({type: EDIT_FILE_FOOT_PRINT, content: filePath});
        return i18nInstance.t('agent.tools.file.edit', {path: filePath});
    },
    guard: fileGuard
}

/**
 * Asked by every tool that reaches for a path, wherever the tool itself lives. What counts as
 * inside is this run's own workspace: a project working in a folder of its own was given that
 * folder by the user, and asking them again for every file in it is asking after what they said.
 */
export function fileGuard(input: FileOperationInput, context: OneLoopContext): ToolGuardResult {
    if (!inRunWorkspace(context, input.filePath)) {
        return PermissionService.askPermissionGuard(
            i18nInstance.t('agent.tools.file.guard'), 'file', context.permissionWhiteList
        );
    }
    return {result: 'allowed'};
}
