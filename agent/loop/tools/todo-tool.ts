import { ToolDesc, ToolUseContext } from './tool-definitions.js';
import { TodoItem } from '../services/todo-manager.js';

type TodoToolInput = {
    items: TodoItem[];
}

export const todoTool: ToolDesc<TodoToolInput> = {
    tool: {
        name: 'todo',
        description: 'Rewrite the current session plan for multi-step work.',
        input_schema: {
            type: 'object',
            properties: {
                items: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            content: {type: 'string'},
                            status: {type: 'enum', enum: ['pending', 'inProgress', 'completed']},
                            activeForm: {type: 'string', description: 'Optional present-continuous label.'}
                        },
                        required: ['content', 'status'],
                    }
                }
            },
            required: ['items'],
        },
    },
    outputToUser: true,
    invoke: async function(input: TodoToolInput, context?: ToolUseContext): Promise<string> {
        context!.oneLoopContext.toDoUpdated = true;
        return context!.oneLoopContext.toDoManager.update(input.items);
    },
}