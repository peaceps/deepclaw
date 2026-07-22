import { ToolDesc, ToolGuardResult } from '../../definitions/tool-definitions';
import { i18nInstance } from '@deepclaw/i18n';
import { FileUtils } from '@deepclaw/node-utils';
import { PermissionService } from '../services/permission-service';
import { OneLoopContext } from '../../definitions/definitions';

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
                limit: {type: 'integer'}
            },
            required: ['filePath']
        },
    },
    agentMode: ['agent'],
    parallelSafe: true,
    invoke: async function(input: ReadFileInput): Promise<string> {
        const { filePath, limit } = input;
        const content = FileUtils.readFile(filePath);
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
    parallelSafe: false,
    exclusiveInSubLoop: true,
    invoke: async function(input: WriteFileInput): Promise<string> {
        const { filePath, content } = input;
        FileUtils.writeFile(filePath, content);
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
    parallelSafe: false,
    exclusiveInSubLoop: true,
    invoke: async function(input: EditFileInput): Promise<string> {
        const { filePath, oldText, newText } = input;
        const content = FileUtils.readFile(filePath);
        const newContent = content.replaceAll(oldText, newText);
        FileUtils.writeFile(filePath, newContent);
        return i18nInstance.t('agent.tools.file.edit', {path: filePath});
    },
    guard: fileGuard
}

function fileGuard(input: FileOperationInput, context: OneLoopContext): ToolGuardResult {
    if (!FileUtils.isPathInWorkspace(input.filePath)) {
        return PermissionService.askPermissionGuard(
            i18nInstance.t('agent.tools.file.guard'), 'file', context.loopId, context.role
        );
    }
    return {result: 'allowed'};
}
