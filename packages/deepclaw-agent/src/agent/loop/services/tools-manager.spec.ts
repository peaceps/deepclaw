import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentMode} from '@deepclaw/config';
import {type ToolDesc} from '../../definitions/tool-definitions';
import {type LoopKind} from '../../definitions/definitions';
import {MCP_PREFIX} from './mcp-service';
import {ToolsManager} from './tools-manager';

const mocks = vi.hoisted(() => ({
    getTools: vi.fn<() => Record<string, ToolDesc<unknown>>>(() => ({})),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

vi.mock('./mcp-service', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./mcp-service')>()),
    MCPService: {getTools: mocks.getTools},
}));

function newMcpTool(name: string, overrides: Partial<ToolDesc<unknown>> = {}): ToolDesc<unknown> {
    return {
        tool: {name, description: 'a tool served over mcp', schema: {type: 'object'}},
        parallelSafe: false,
        agentMode: ['agent'],
        invoke: vi.fn(async () => 'ok'),
        ...overrides,
    };
}

function names(loopKind: LoopKind, mode: AgentMode): string[] {
    return ToolsManager.getToolsArray(loopKind, mode).map(tool => tool.name);
}

// Loaded inside the test rather than up top: an eager import here keeps the mock above from
// ever being applied, which quietly hands the real mcp service to every test below.
function toolModules(): Promise<Record<string, unknown>[]> {
    return Promise.all([
        import('../tools/agent-runtime-tool'),
        import('../tools/ask-user-tool'),
        import('../tools/background-command-tool'),
        import('../tools/cron-tool'),
        import('../tools/encode-decode-tool'),
        import('../tools/file-tool'),
        import('../tools/image-tool'),
        import('../tools/project-tool'),
        import('../tools/save-memory-tool'),
        import('../tools/skill-tool'),
        import('../tools/spawned-loop-tool'),
        import('../tools/sync-command-tool'),
    ]);
}

function isToolDesc(value: unknown): value is ToolDesc<unknown> {
    return typeof value === 'object' && value !== null && 'tool' in value && 'invoke' in value;
}

/** Every tool the tools folder exports is meant to be offered, an unregistered one is unreachable. */
async function exportedToolNames(): Promise<string[]> {
    return (await toolModules())
        .flatMap(module => Object.values(module))
        .filter(isToolDesc)
        .map(tool => tool.tool.name);
}

const KINDS: LoopKind[] = ['main', 'task', 'sub'];
const CONTEXTS: [LoopKind, AgentMode][] = KINDS.flatMap(
    kind => (['agent', 'chat'] as AgentMode[]).map(mode => [kind, mode] as [LoopKind, AgentMode])
);

describe('built-in tools', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTools.mockReturnValue({});
    });

    test('serves a tool to the mode it declares', () => {
        expect(ToolsManager.getToolDesc('main', 'agent', 'read_file')?.tool.name).toBe('read_file');
        expect(ToolsManager.getToolDesc('main', 'chat', 'read_file')).toBeUndefined();
    });

    test('hides a main loop only tool from every spawned loop', () => {
        expect(ToolsManager.getToolDesc('main', 'agent', 'update_task')?.tool.name).toBe('update_task');
        expect(ToolsManager.getToolDesc('task', 'agent', 'update_task')).toBeUndefined();
        expect(ToolsManager.getToolDesc('sub', 'agent', 'update_task')).toBeUndefined();
    });

    test('hands the tasks of a project out of the main loop only', () => {
        expect(ToolsManager.getToolDesc('main', 'agent', 'task_loop')?.tool.name).toBe('task_loop');
        expect(ToolsManager.getToolDesc('task', 'agent', 'task_loop')).toBeUndefined();
        expect(ToolsManager.getToolDesc('sub', 'agent', 'task_loop')).toBeUndefined();
    });

    test('lets a task loop spawn sub loops where a sub loop spawns none', () => {
        expect(ToolsManager.getToolDesc('main', 'agent', 'sub_loop')?.tool.name).toBe('sub_loop');
        expect(ToolsManager.getToolDesc('task', 'agent', 'sub_loop')?.tool.name).toBe('sub_loop');
        expect(ToolsManager.getToolDesc('sub', 'agent', 'sub_loop')).toBeUndefined();
    });

    test('leaves the step index of a task to whoever works it', () => {
        expect(ToolsManager.getToolDesc('main', 'agent', 'update_task_current_step')).toBeDefined();
        expect(ToolsManager.getToolDesc('task', 'agent', 'update_task_current_step')).toBeDefined();
        expect(ToolsManager.getToolDesc('sub', 'agent', 'update_task_current_step')).toBeUndefined();
    });

    test('returns undefined for a tool nobody registered', () => {
        expect(ToolsManager.getToolDesc('main', 'agent', 'no_such_tool')).toBeUndefined();
    });

    test('lists every tool only once', () => {
        for (const [loopKind, mode] of CONTEXTS) {
            const listed = names(loopKind, mode);
            expect(new Set(listed).size).toBe(listed.length);
        }
    });

    test('can look up every tool it lists', () => {
        for (const [loopKind, mode] of CONTEXTS) {
            for (const name of names(loopKind, mode)) {
                expect(ToolsManager.getToolDesc(loopKind, mode, name)).toBeDefined();
            }
        }
    });

    test('only lists tools that declare the current mode', () => {
        for (const [loopKind, mode] of CONTEXTS) {
            for (const name of names(loopKind, mode)) {
                expect(ToolsManager.getToolDesc(loopKind, mode, name)!.agentMode).toContain(mode);
            }
        }
    });

    test('never lists a tool for a kind of loop it was kept from', () => {
        for (const [loopKind, mode] of CONTEXTS) {
            for (const name of names(loopKind, mode)) {
                const kinds = ToolsManager.getToolDesc(loopKind, mode, name)!.loopKinds;
                expect(kinds ?? [loopKind]).toContain(loopKind);
            }
        }
    });

    test('registers exactly the tools the tools folder exports', async () => {
        const registered = new Set(CONTEXTS.flatMap(([loopKind, mode]) => names(loopKind, mode)));
        expect([...registered].sort()).toEqual([...new Set(await exportedToolNames())].sort());
    });

    test('offers the project update to the agent of a main loop', () => {
        expect(ToolsManager.getToolDesc('main', 'agent', 'update_project')?.tool.name).toBe('update_project');
    });

    test('gives out a fresh array so callers cannot corrupt the registry', () => {
        const first = ToolsManager.getToolsArray('main', 'agent');
        first.length = 0;
        expect(ToolsManager.getToolsArray('main', 'agent').length).toBeGreaterThan(0);
    });
});

describe('mcp tools', () => {
    const mcpName = `${MCP_PREFIX}server_add`;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTools.mockReturnValue({});
    });

    test('adds the tools of the connected server to the list', () => {
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName)});
        expect(names('main', 'agent')).toContain(mcpName);
    });

    /**
     * The tools are read before anything else of a prompt, so their order decides whether a cache
     * is found at all. Servers answer in whatever order they answer in, which is none.
     */
    test('hands the served tools over by name, whatever order they arrived in', () => {
        const served = [`${MCP_PREFIX}zebra`, `${MCP_PREFIX}apple`, `${MCP_PREFIX}mango`];
        mocks.getTools.mockReturnValue(Object.fromEntries(
            served.map(name => [name, newMcpTool(name)])
        ));
        expect(names('main', 'agent').slice(-served.length)).toEqual([...served].sort());
    });

    test('looks a tool up by its prefixed name', () => {
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName)});
        expect(ToolsManager.getToolDesc('main', 'agent', mcpName)?.tool.name).toBe(mcpName);
    });

    test('appends the mcp tools behind the built-in ones', () => {
        const builtIn = names('main', 'agent');
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName)});
        expect(names('main', 'agent')).toEqual([...builtIn, mcpName]);
    });

    test('applies the declared mode to an mcp tool as well', () => {
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName, {agentMode: ['agent']})});
        expect(ToolsManager.getToolDesc('main', 'chat', mcpName)).toBeUndefined();
        expect(names('main', 'chat')).not.toContain(mcpName);
    });

    test('serves an mcp tool that declares the chat mode', () => {
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName, {agentMode: ['agent', 'chat']})});
        expect(ToolsManager.getToolDesc('main', 'chat', mcpName)?.tool.name).toBe(mcpName);
        expect(names('main', 'chat')).toContain(mcpName);
    });

    test('hides an mcp tool that is exclusive to the main loop from spawned loops', () => {
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName, {loopKinds: ['main']})});
        expect(ToolsManager.getToolDesc('task', 'agent', mcpName)).toBeUndefined();
        expect(ToolsManager.getToolDesc('sub', 'agent', mcpName)).toBeUndefined();
        expect(names('sub', 'agent')).not.toContain(mcpName);
        expect(ToolsManager.getToolDesc('main', 'agent', mcpName)).toBeDefined();
    });

    test('shares an mcp tool with every kind of loop by default', () => {
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName)});
        expect(ToolsManager.getToolDesc('task', 'agent', mcpName)?.tool.name).toBe(mcpName);
        expect(ToolsManager.getToolDesc('sub', 'agent', mcpName)?.tool.name).toBe(mcpName);
    });

    test('returns undefined for an mcp name the server does not serve', () => {
        expect(ToolsManager.getToolDesc('main', 'agent', `${MCP_PREFIX}ghost`)).toBeUndefined();
    });

    test('never falls back to a built-in tool for a prefixed name', () => {
        expect(ToolsManager.getToolDesc('main', 'agent', `${MCP_PREFIX}read_file`)).toBeUndefined();
    });

    test('leaves the built-in tools alone while no server is connected', () => {
        const withoutServer = names('main', 'agent');
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName)});
        mocks.getTools.mockReturnValue({});
        expect(names('main', 'agent')).toEqual(withoutServer);
    });
});
