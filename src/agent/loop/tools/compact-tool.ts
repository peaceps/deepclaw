import { ToolDesc, ToolUseContext } from "../../definitions/tool-definitions.js";

type CompactInput = {
    focus: string;
}

export const compactTool: ToolDesc<CompactInput> = {
    tool: {
        name: 'compact',
        description: 'Summarize earlier conversation so work can continue in a smaller context.',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
        },
    },
    parallelSafe: false,
    invoke: async function(_: CompactInput, context: ToolUseContext): Promise<string> {
        await context.loop.compact();
        return 'History compacted.';
    },
}
