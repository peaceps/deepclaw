import { ToolDesc, ToolUseContext } from '../../definitions/tool-definitions.js';
import { TodoItem } from '../services/todo-manager.js';

type TodoToolInput = {
    items: TodoItem[];
}

export const todoTool: ToolDesc<TodoToolInput> = {
    tool: {
        name: 'todo',
        description: 'Rewrite the current session plan for multi-step work.',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                items: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            content: {type: 'string'},
                            status: {type: 'string', enum: ['pending', 'inProgress', 'completed']},
                            activeForm: {type: 'string', description: 'Optional present-continuous label.'}
                        },
                        required: ['content', 'status'],
                    }
                }
            },
            required: ['items'],
        },
    },
    parallelSafe: false,
    outputToUser: true,
    invoke: async function(input: TodoToolInput, context?: ToolUseContext): Promise<string> {
        context!.oneLoopContext.toDoUpdated = true;
        return context!.oneLoopContext.toDoManager.update(input.items);
    },
}
