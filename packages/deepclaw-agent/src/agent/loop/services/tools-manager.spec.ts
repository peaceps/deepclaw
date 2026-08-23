import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentMode} from '@deepclaw/config';
import {type FlushAgentRole} from '@deepclaw/core';
import {ALL_AGENT_ROLES, type ToolDesc, type ToolRun} from '../../definitions/tool-definitions';
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

/** A run to ask the manager about, under the plain role wherever a test says nothing of one. */
function run(loopKind: LoopKind, mode: AgentMode, role: FlushAgentRole = 'agent'): ToolRun {
    return {loopKind, role, mode};
}

function names(toolRun: ToolRun): string[] {
    return ToolsManager.getToolsArray(toolRun).map(tool => tool.name);
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
const ROLES: FlushAgentRole[] = ['agent', 'project', 'cron'];
const MODES: AgentMode[] = ['agent', 'chat'];
const RUNS: ToolRun[] = KINDS.flatMap(
    loopKind => ROLES.flatMap(role => MODES.map(mode => ({loopKind, role, mode})))
);

describe('built-in tools', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTools.mockReturnValue({});
    });

    test('serves a tool to the mode it declares', () => {
        expect(ToolsManager.getToolDesc(run('main', 'agent'), 'read_file')?.tool.name).toBe('read_file');
        expect(ToolsManager.getToolDesc(run('main', 'chat'), 'read_file')).toBeUndefined();
    });

    test('hides a main loop only tool from every spawned loop', () => {
        expect(ToolsManager.getToolDesc(run('main', 'agent'), 'update_task')?.tool.name).toBe('update_task');
        expect(ToolsManager.getToolDesc(run('task', 'agent'), 'update_task')).toBeUndefined();
        expect(ToolsManager.getToolDesc(run('sub', 'agent'), 'update_task')).toBeUndefined();
    });

    // 项目运行是唯一拿得到这个工具的角色，所以这里只比循环层级这一维
    test('hands the tasks of a project out of the main loop only', () => {
        expect(ToolsManager.getToolDesc(run('main', 'agent', 'project'), 'task_loop')?.tool.name)
            .toBe('task_loop');
        expect(ToolsManager.getToolDesc(run('task', 'agent', 'project'), 'task_loop')).toBeUndefined();
        expect(ToolsManager.getToolDesc(run('sub', 'agent', 'project'), 'task_loop')).toBeUndefined();
    });

    test('lets a task loop spawn sub loops where a sub loop spawns none', () => {
        expect(ToolsManager.getToolDesc(run('main', 'agent'), 'sub_loop')?.tool.name).toBe('sub_loop');
        expect(ToolsManager.getToolDesc(run('task', 'agent'), 'sub_loop')?.tool.name).toBe('sub_loop');
        expect(ToolsManager.getToolDesc(run('sub', 'agent'), 'sub_loop')).toBeUndefined();
    });

    test('leaves the step index of a task to whoever works it', () => {
        expect(ToolsManager.getToolDesc(run('main', 'agent'), 'update_task_current_step')).toBeDefined();
        expect(ToolsManager.getToolDesc(run('task', 'agent'), 'update_task_current_step')).toBeDefined();
        expect(ToolsManager.getToolDesc(run('sub', 'agent'), 'update_task_current_step')).toBeUndefined();
    });

    // 只有定时运行才有自己的产出可写，别的运行拿到它只能去改别人的记录
    test('leaves the output of a scheduled run to a run that is one', () => {
        expect(ToolsManager.getToolDesc(run('main', 'agent', 'cron'), 'update_cron_output')?.tool.name)
            .toBe('update_cron_output');
        expect(ToolsManager.getToolDesc(run('main', 'agent', 'agent'), 'update_cron_output')).toBeUndefined();
        expect(ToolsManager.getToolDesc(run('main', 'agent', 'project'), 'update_cron_output')).toBeUndefined();
        expect(names(run('main', 'agent'))).not.toContain('update_cron_output');
    });

    // 排期是随时能聊的事情，读历史也是，只有写产出被关了起来
    test('still lets any run set a schedule up and read what earlier runs said', () => {
        for (const name of ['create_cron_task', 'update_cron_task', 'get_cron_histories']) {
            expect(ToolsManager.getToolDesc(run('main', 'agent'), name)?.tool.name).toBe(name);
        }
    });

    // 只有项目运行有看板可派任务：定时运行的那个 id 是它的定时任务，普通对话压根没有项目
    test('hands the task board to a project run and to no other run', () => {
        expect(ToolsManager.getToolDesc(run('main', 'agent', 'project'), 'task_loop')?.tool.name)
            .toBe('task_loop');
        for (const role of ['agent', 'cron'] as FlushAgentRole[]) {
            expect(ToolsManager.getToolDesc(run('main', 'agent', role), 'task_loop')).toBeUndefined();
            expect(names(run('main', 'agent', role))).not.toContain('task_loop');
        }
    });

    // 派不了任务不等于开不了子循环，自己的活照样能拆出去
    test('leaves every run the subagents it spawns for work of its own', () => {
        for (const role of ALL_AGENT_ROLES) {
            expect(ToolsManager.getToolDesc(run('main', 'agent', role), 'sub_loop')?.tool.name)
                .toBe('sub_loop');
        }
    });

    test('returns undefined for a tool nobody registered', () => {
        expect(ToolsManager.getToolDesc(run('main', 'agent'), 'no_such_tool')).toBeUndefined();
    });

    test('lists every tool only once', () => {
        for (const toolRun of RUNS) {
            const listed = names(toolRun);
            expect(new Set(listed).size).toBe(listed.length);
        }
    });

    test('can look up every tool it lists', () => {
        for (const toolRun of RUNS) {
            for (const name of names(toolRun)) {
                expect(ToolsManager.getToolDesc(toolRun, name)).toBeDefined();
            }
        }
    });

    test('only lists tools that declare the current mode', () => {
        for (const toolRun of RUNS) {
            for (const name of names(toolRun)) {
                expect(ToolsManager.getToolDesc(toolRun, name)!.agentMode).toContain(toolRun.mode);
            }
        }
    });

    test('never lists a tool for a kind of loop it was kept from', () => {
        for (const toolRun of RUNS) {
            for (const name of names(toolRun)) {
                const kinds = ToolsManager.getToolDesc(toolRun, name)!.loopKinds;
                expect(kinds ?? [toolRun.loopKind]).toContain(toolRun.loopKind);
            }
        }
    });

    // 同上，只是换成运行身份这一维
    test('never lists a tool for a role it was kept from', () => {
        for (const toolRun of RUNS) {
            for (const name of names(toolRun)) {
                const roles = ToolsManager.getToolDesc(toolRun, name)!.roles;
                expect(roles ?? [toolRun.role]).toContain(toolRun.role);
            }
        }
    });

    test('registers exactly the tools the tools folder exports', async () => {
        const registered = new Set(RUNS.flatMap(names));
        expect([...registered].sort()).toEqual([...new Set(await exportedToolNames())].sort());
    });

    test('offers the project update to the agent of a main loop', () => {
        expect(ToolsManager.getToolDesc(run('main', 'agent'), 'update_project')?.tool.name).toBe('update_project');
    });

    test('gives out a fresh array so callers cannot corrupt the registry', () => {
        const first = ToolsManager.getToolsArray(run('main', 'agent'));
        first.length = 0;
        expect(ToolsManager.getToolsArray(run('main', 'agent')).length).toBeGreaterThan(0);
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
        expect(names(run('main', 'agent'))).toContain(mcpName);
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
        expect(names(run('main', 'agent')).slice(-served.length)).toEqual([...served].sort());
    });

    test('looks a tool up by its prefixed name', () => {
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName)});
        expect(ToolsManager.getToolDesc(run('main', 'agent'), mcpName)?.tool.name).toBe(mcpName);
    });

    test('appends the mcp tools behind the built-in ones', () => {
        const builtIn = names(run('main', 'agent'));
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName)});
        expect(names(run('main', 'agent'))).toEqual([...builtIn, mcpName]);
    });

    test('applies the declared mode to an mcp tool as well', () => {
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName, {agentMode: ['agent']})});
        expect(ToolsManager.getToolDesc(run('main', 'chat'), mcpName)).toBeUndefined();
        expect(names(run('main', 'chat'))).not.toContain(mcpName);
    });

    test('serves an mcp tool that declares the chat mode', () => {
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName, {agentMode: ['agent', 'chat']})});
        expect(ToolsManager.getToolDesc(run('main', 'chat'), mcpName)?.tool.name).toBe(mcpName);
        expect(names(run('main', 'chat'))).toContain(mcpName);
    });

    test('hides an mcp tool that is exclusive to the main loop from spawned loops', () => {
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName, {loopKinds: ['main']})});
        expect(ToolsManager.getToolDesc(run('task', 'agent'), mcpName)).toBeUndefined();
        expect(ToolsManager.getToolDesc(run('sub', 'agent'), mcpName)).toBeUndefined();
        expect(names(run('sub', 'agent'))).not.toContain(mcpName);
        expect(ToolsManager.getToolDesc(run('main', 'agent'), mcpName)).toBeDefined();
    });

    // 服务端的工具也认这一维，规则对内建工具和 mcp 工具是同一套
    test('applies the declared roles to an mcp tool as well', () => {
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName, {roles: ['cron']})});
        expect(ToolsManager.getToolDesc(run('main', 'agent', 'cron'), mcpName)?.tool.name).toBe(mcpName);
        expect(ToolsManager.getToolDesc(run('main', 'agent'), mcpName)).toBeUndefined();
        expect(names(run('main', 'agent'))).not.toContain(mcpName);
    });

    test('shares an mcp tool with every kind of loop by default', () => {
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName)});
        expect(ToolsManager.getToolDesc(run('task', 'agent'), mcpName)?.tool.name).toBe(mcpName);
        expect(ToolsManager.getToolDesc(run('sub', 'agent'), mcpName)?.tool.name).toBe(mcpName);
    });

    test('shares an mcp tool with every role by default', () => {
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName)});
        expect(ToolsManager.getToolDesc(run('main', 'agent', 'cron'), mcpName)?.tool.name).toBe(mcpName);
        expect(ToolsManager.getToolDesc(run('main', 'agent', 'project'), mcpName)?.tool.name).toBe(mcpName);
    });

    test('returns undefined for an mcp name the server does not serve', () => {
        expect(ToolsManager.getToolDesc(run('main', 'agent'), `${MCP_PREFIX}ghost`)).toBeUndefined();
    });

    test('never falls back to a built-in tool for a prefixed name', () => {
        expect(ToolsManager.getToolDesc(run('main', 'agent'), `${MCP_PREFIX}read_file`)).toBeUndefined();
    });

    test('leaves the built-in tools alone while no server is connected', () => {
        const withoutServer = names(run('main', 'agent'));
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName)});
        mocks.getTools.mockReturnValue({});
        expect(names(run('main', 'agent'))).toEqual(withoutServer);
    });
});
