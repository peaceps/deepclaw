import { FileUtils } from '@deepclaw/node-utils';
import { OneLoopContext } from '../../definitions/definitions';
import { ToolDesc } from '../../definitions/tool-definitions';
import { LoopAgent } from '../loop/loop';

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
    agentMode: ['agent'],
    parallelSafe: true,
    exclusiveInSubLoop: true,
    invoke: async function(input: SubLoopInput, context: OneLoopContext): Promise<string> {
        const subLoop = context.actions.newSubLoop() as LoopAgent<any, any, any>;
        const result = await subLoop.invoke(input.prompt, { browserId: context.browserId });
        FileUtils.deleteDir(subLoop.getSessionDir());
        return result.text;
    },
}
