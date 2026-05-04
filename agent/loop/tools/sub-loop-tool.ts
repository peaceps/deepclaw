import { ToolDesc } from './tool-definitions.js';
import { SubLoopAgent } from '../loop.js';

type SubLoopInput = {
    prompt: string;
    description?: string;
}

export const subLoopTool: ToolDesc<SubLoopInput> = {
    tool: {
        name: 'sub_loop',
        description: 'Spawn a subagent with fresh context. It shares the filesystem but not conversation history.',
        input_schema: {
            type: 'object',
            properties: {
                prompt: {type: 'string', description: 'The task prompt for the sub-agent'},
                description: {type: 'string', description: 'Short description of the task'}
            },
            required: ['prompt']}
    },
    invoke: async function(input: SubLoopInput): Promise<string> {
        const subLoop = new SubLoopAgent();
        const result = await subLoop.invoke(input.prompt);
        return result;
    },
}