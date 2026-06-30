import { OneLoopContext } from "../../definitions/definitions";
import { ToolDesc } from "../../definitions/tool-definitions";
import { MEMORY_SCOPES, MEMORY_TYPES, MemoryManager, MemoryScope, MemoryType } from "../services/memory-manager";

const MEMORY_NAME_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

type SaveMemoryInput = {
    type: MemoryType;
    name: string;
    description: string;
    content: string;
    scope: MemoryScope;
}

export const saveMemoryTool: ToolDesc<SaveMemoryInput> = {
    tool: {
        name: 'save_memory',
        description: `Save a persistent memory that survives across sessions.
You can update old memory content via its name if you are sure the old memory is no longer valid.`,
        schema: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    enum: MEMORY_TYPES,
                    description: `What kind of memory this is:
- type preference: user's or team's preferred style, habits, defaults, tool choices.
- type rules: constraints, corrections, project facts, decisions, safety/business rules that should be followed later.
- type reference: pointers to external resources, docs, dashboards, tickets, not the copied content.`,
                },
                name: {
                    type: 'string',
                    description: 'Short unique identifier within selected scope. Use only letters, numbers, "_" or "-".',
                    pattern: '^[A-Za-z0-9_-]{1,80}$'
                },
                description: { type: 'string', description: 'One-line summary of what this memory captures' },
                content: { type: 'string', description: 'Full memory content (multi-line OK)' },
                scope: {
                    type: 'string',
                    enum: MEMORY_SCOPES,
                    description: `Where to save the memory:
- global: shared by all agents (e.g. user preferences, org-wide references).
- agent: private to the current agent (e.g. feedback/corrections for this agent).
- project: shared within the current project (only valid when working on a project).
- global has the widest scope, followed by agent and project.`
                },
            },
            required: ['type', 'name', 'description', 'content', 'scope'],
        },
    },
    agentMode: ['agent', 'chat'],
    exclusiveInSubLoop: true,
    parallelSafe: true,
    invoke: async (input: SaveMemoryInput, context: OneLoopContext): Promise<string> => {
        const { agentId, projectId } = parseScope(input.scope, context);
        if (input.scope === 'project' && !projectId) {
            return 'Cannot update a project memory outside project chat.';
        }
        if (!MEMORY_NAME_PATTERN.test(input.name)) {
            return 'Invalid memory name. Use only letters, numbers, "_" or "-", length 1-80.';
        }
        MemoryManager.addMemory({
            type: input.type,
            name: input.name,
            description: input.description,
            content: input.content,
        }, agentId, projectId);
        return 'Memory saved successfully.';
    },
}

type ReadMemoryDetailInput = {
    name: string;
    scope: MemoryScope;
}

export const readMemoryDetailTool: ToolDesc<ReadMemoryDetailInput> = {
    tool: {
        name: 'read_memory_detail',
        description: 'Read the detail of a memory.',
        schema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'name of memory to load',
                    pattern: '^[A-Za-z0-9_-]{1,80}$',
                },
                scope: {
                    type: 'string',
                    enum: MEMORY_SCOPES,
                    description: 'scope of memory to load'
                },
            },
            required: ['name', 'scope'],
        },
    },
    agentMode: ['agent', 'chat'],
    exclusiveInSubLoop: false,
    parallelSafe: false,
    invoke: async (input: ReadMemoryDetailInput, context: OneLoopContext): Promise<string> => {
        const { agentId, projectId } = parseScope(input.scope, context);
        if (input.scope === 'project' && !projectId) {
            return 'Cannot get a project memory outside project chat.';
        }
        return MemoryManager.getMemoryDetail(input.name, agentId, projectId);
    },
}

function parseScope(scope: MemoryScope, context: OneLoopContext): { agentId?: string, projectId?: string } {
    const agentId = scope !== 'global' ? context.agentId : undefined;
    const projectId = scope === 'project' ? context.projectId : undefined;
    return { agentId, projectId };
}
