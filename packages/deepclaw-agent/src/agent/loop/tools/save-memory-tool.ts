import { OneLoopContext } from "../../definitions/definitions";
import { ToolDesc } from "../../definitions/tool-definitions";
import { MemoryManager, MemoryType } from "../services/memory-manager";

type SaveMemoryInput = {
    type: MemoryType;
    name: string;
    description: string;
    content: string;
}

export const saveMemoryTool: ToolDesc<SaveMemoryInput> = {
    tool: {
        name: 'save_memory',
        description: `Save a persistent memory that survives across sessions.
You can update old memory content via its type and name if you are sure the old memory is no longer valid.`,
        schema: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    enum: ['user', 'feedback', 'project', 'reference'],
                    description:
                        'user=preferences, feedback=corrections, project=non-obvious project conventions or decision reasons, reference=external resource pointers',
                },
                name: { type: 'string', description: 'Short identifier (e.g. prefer_tabs, db_schema)' },
                description: { type: 'string', description: 'One-line summary of what this memory captures' },
                content: { type: 'string', description: 'Full memory content (multi-line OK)' },
            },
            required: ['type', 'name', 'description', 'content'],
        },
    },
    agentMode: ['agent', 'plan', 'chat'],
    exclusiveInSubLoop: true,
    parallelSafe: false,
    invoke: async (input: SaveMemoryInput, context: OneLoopContext): Promise<string> => {
        MemoryManager.addMemory(context.loopName, input);
        return 'Memory saved successfully.';
    },
}
