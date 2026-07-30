import { ToolDesc } from "../../definitions/tool-definitions";

type Base64Input = {
    content: string;
    action: 'encode' | 'decode';
};

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

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
        if (action === 'encode') {
            return Buffer.from(content, 'utf8').toString('base64');
        }
        // Buffer drops anything that is not base64 instead of complaining, which reads as mojibake.
        const compact = content.replace(/\s/g, '');
        if (!BASE64_PATTERN.test(compact) || compact.length % 4 === 1) {
            throw new Error('The content to decode is not valid base64.');
        }
        return Buffer.from(compact, 'base64').toString('utf8');
    }
}
