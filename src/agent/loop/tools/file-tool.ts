import fs from 'fs/promises';
import path from 'path';
import { ToolDesc, ToolGuardResult } from '../../definitions/tool-definitions.js';

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
        const content = await fs.readFile(filePath, 'utf8');
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
        await fs.writeFile(filePath, content, 'utf8');
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
        const content = await fs.readFile(filePath, 'utf8');
        const newContent = content.replaceAll(oldText, newText);
        await fs.writeFile(filePath, newContent, 'utf8');
        return `Edit ${filePath} successfully.`;
    },
    guard: fileGuard
}

function fileGuard(input: ReadFileInput): ToolGuardResult {
    const filePath = input.filePath.replaceAll('\\', '/');
    const cwd = process.cwd().replaceAll('\\', '/');
    if (path.isAbsolute(filePath)) {
        if (!filePath.startsWith(`${cwd}/`)) {
            return {allowed: false, feedback: 'You don\'t have permission to operate file out of workspace.'};
        }
    } else if (filePath.startsWith('..')) {
        if (!filePath.startsWith(cwd)) {
            return {allowed: false, feedback: 'You don\'t have permission to operate file out of workspace.'};
        }
    }
    return {allowed: true};
}