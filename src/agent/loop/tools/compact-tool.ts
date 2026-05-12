import { ToolDesc } from "../../definitions/tool-definitions.js";

type CompactInput = {
    focus: string;
}

export const compact: ToolDesc<CompactInput> = {
    tool: {
        name: 'compact',
        description: 'Summarize earlier conversation so work can continue in a smaller context.',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {focus: {
                type: 'string',
                description: 'The focus of the compacted context, which should be paid attention to next.'
            }},
        },
    },
    invoke: async function(input: CompactInput): Promise<string> {
        const { focus } = input;
        return focus;
    },
}
