import { ToolDesc } from "../../definitions/tool-definitions";

type Base64Input = {
    content: string;
    action: 'encode' | 'decode';
};

export const base64Tool: ToolDesc<Base64Input> = {
    tool: {
        name: 'base64',
        description: 'Encode or decode base64 content',
        schema: {
            type: 'object',
            properties: {
                content: {type: 'string'},
                action: {type: 'string', enum: ['encode', 'decode']}
            },
            required: ['content', 'action']
        },
    },
    agentMode: ['agent'],
    parallelSafe: true,
    invoke: async function(input: Base64Input): Promise<string> {
        const { content, action } = input;
        return action === 'encode' ? Buffer.from(content, 'utf8').toString('base64') : Buffer.from(content, 'base64').toString('utf8');
    }
}
