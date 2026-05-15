import { ToolDesc, ToolUseContext } from '../../definitions/tool-definitions.js';

type SubLoopInput = {
    prompt: string;
}

export const subLoopTool: ToolDesc<SubLoopInput> = {
    tool: {
        name: 'sub_loop',
        description: 'Spawn a subagent with fresh context. It shares the filesystem but not conversation history.',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                prompt: {type: 'string', description: 'The task prompt for the sub-agent'},
            },
            required: ['prompt']}
    },
    agentMode: ['agent', 'plan'],
    parallelSafe: true,
    exclusiveInSubLoop: true,
    invoke: async function(input: SubLoopInput, context: ToolUseContext): Promise<string> {
        const subLoop = context.loop.createSubLoop(false);
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
        schema: {
            type: 'object',
            properties: {
                prompt: {type: 'string', description: 'The task prompt for the sub-agent'},
            },
            required: ['prompt']}
    },
    agentMode: ['agent', 'plan'],
    parallelSafe: true,
    exclusiveInSubLoop: true,
    invoke: async function(input: SubLoopInput, context: ToolUseContext): Promise<string> {
        const subLoop = context.loop.createSubLoop(true);
        const result = await subLoop.invoke(input.prompt);
        return result;
    },
}
