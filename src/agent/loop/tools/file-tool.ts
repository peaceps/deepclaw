import { ToolDesc, ToolGuardResult } from '../../definitions/tool-definitions.js';
import { FileUtils } from '@utils';

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
    invoke: async function(input: WriteFileInput): Promise<string> {
        const { filePath, content } = input;
        FileUtils.writeFile(filePath, content);
        return `Wrote ${content.length} bytes to ${filePath}.`;
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
    invoke: async function(input: EditFileInput): Promise<string> {
        const { filePath, oldText, newText } = input;
        const content = FileUtils.readFile(filePath);
        const newContent = content.replaceAll(oldText, newText);
        FileUtils.writeFile(filePath, newContent);
        return `Edit ${filePath} successfully.`;
    },
    guard: fileGuard
}

function fileGuard(input: ReadFileInput): ToolGuardResult {
    if (!FileUtils.isPathInWorkspace(input.filePath)) {
        return {allowed: false, feedback: 'You don\'t have permission to operate file out of workspace.'};
    }
    return {allowed: true};
}
