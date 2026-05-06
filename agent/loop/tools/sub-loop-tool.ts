import { ToolDesc, ToolUseContext } from './tool-definitions.js';
import { SubLoopAgent } from '../loop.js';

type SubLoopInput = {
    prompt: string;
}

export const subLoopTool: ToolDesc<SubLoopInput> = {
    tool: {
        name: 'sub_loop',
        description: 'Spawn a subagent with fresh context. It shares the filesystem but not conversation history.',
        input_schema: {
            type: 'object',
            properties: {
                prompt: {type: 'string', description: 'The task prompt for the sub-agent'},
            },
            required: ['prompt']}
    },
    invoke: async function(input: SubLoopInput): Promise<string> {
        const subLoop = new SubLoopAgent();
        const result = await subLoop.invoke(input.prompt);
        return result;
    },
}

export const subLoopWithHistoryTool: ToolDesc<SubLoopInput> = {
    tool: {
        name: 'sub_loop_with_history',
        description: `Spawn a subagent with history from the parent agent context.
        It shares the filesystem as well as conversation history. 
        Only when special cases that need the subagent to have the full context of the parent agent, this tool should be used. 
        Otherwise, it's recommended to use the 'sub_loop' tool to avoid potential confusion from too much context.`,
        input_schema: {
            type: 'object',
            properties: {
                prompt: {type: 'string', description: 'The task prompt for the sub-agent'},
            },
            required: ['prompt']}
    },
    invoke: async function(input: SubLoopInput, context: ToolUseContext): Promise<string> {
        const subLoop = new SubLoopAgent(context.history);
        const result = await subLoop.invoke(input.prompt);
        return result;
    },
}