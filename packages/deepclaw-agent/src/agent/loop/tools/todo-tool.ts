import { OneLoopContext } from '../../definitions/definitions.js';
import { ToolDesc } from '../../definitions/tool-definitions.js';
import { TodoItem } from '../services/todo-manager.js';

type TodoToolInput = {
    items: TodoItem[];
}

export const todoTool: ToolDesc<TodoToolInput> = {
    tool: {
        name: 'todo',
        description: 'Rewrite the current session plan for multi-step work. Max todo item count is 12.',
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
                    },
                    maxItems: 12
                }
            },
            required: ['items'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: false,
    outputToUser: true,
    invoke: async function(input: TodoToolInput, context: OneLoopContext): Promise<string> {
        return context.todoManager.update(input.items);
    },
}
