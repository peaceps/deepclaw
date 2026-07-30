import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentMode} from '@deepclaw/config';
import {type ToolDesc} from '../../definitions/tool-definitions';
import {MCP_PREFIX} from './mcp-service';
import {ToolsManager} from './tools-manager';
import * as backgroundCommandTools from '../tools/background-command-tool';
import * as cronTools from '../tools/cron-tool';
import * as encodeDecodeTools from '../tools/encode-decode-tool';
import * as fileTools from '../tools/file-tool';
import * as projectTools from '../tools/project-tool';
import * as saveMemoryTools from '../tools/save-memory-tool';
import * as skillTools from '../tools/skill-tool';
import * as subLoopTools from '../tools/sub-loop-tool';
import * as syncCommandTools from '../tools/sync-command-tool';

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
        exclusiveInSubLoop: false,
        invoke: vi.fn(async () => 'ok'),
        ...overrides,
    };
}

function names(isSubLoop: boolean, mode: AgentMode): string[] {
    return ToolsManager.getToolsArray(isSubLoop, mode).map(tool => tool.name);
}

const TOOL_MODULES = [
    backgroundCommandTools, cronTools, encodeDecodeTools, fileTools, projectTools,
    saveMemoryTools, skillTools, subLoopTools, syncCommandTools,
];

function isToolDesc(value: unknown): value is ToolDesc<unknown> {
    return typeof value === 'object' && value !== null && 'tool' in value && 'invoke' in value;
}

/** Every tool the tools folder exports is meant to be offered, an unregistered one is unreachable. */
function exportedToolNames(): string[] {
    return TOOL_MODULES
        .flatMap(module => Object.values(module))
        .filter(isToolDesc)
        .map(tool => tool.tool.name);
}

const CONTEXTS: [boolean, AgentMode][] = [[false, 'agent'], [false, 'chat'], [true, 'agent'], [true, 'chat']];

describe('built-in tools', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTools.mockReturnValue({});
    });

    test('serves a tool to the mode it declares', () => {
        expect(ToolsManager.getToolDesc(false, 'agent', 'read_file')?.tool.name).toBe('read_file');
        expect(ToolsManager.getToolDesc(false, 'chat', 'read_file')).toBeUndefined();
    });

    test('hides a main loop only tool from sub loops', () => {
        expect(ToolsManager.getToolDesc(false, 'agent', 'write_file')?.tool.name).toBe('write_file');
        expect(ToolsManager.getToolDesc(true, 'agent', 'write_file')).toBeUndefined();
    });

    test('returns undefined for a tool nobody registered', () => {
        expect(ToolsManager.getToolDesc(false, 'agent', 'no_such_tool')).toBeUndefined();
    });

    test('lists every tool only once', () => {
        for (const [isSubLoop, mode] of CONTEXTS) {
            const listed = names(isSubLoop, mode);
            expect(new Set(listed).size).toBe(listed.length);
        }
    });

    test('can look up every tool it lists', () => {
        for (const [isSubLoop, mode] of CONTEXTS) {
            for (const name of names(isSubLoop, mode)) {
                expect(ToolsManager.getToolDesc(isSubLoop, mode, name)).toBeDefined();
            }
        }
    });

    test('only lists tools that declare the current mode', () => {
        for (const [isSubLoop, mode] of CONTEXTS) {
            for (const name of names(isSubLoop, mode)) {
                expect(ToolsManager.getToolDesc(isSubLoop, mode, name)!.agentMode).toContain(mode);
            }
        }
    });

    test('never lists a main loop only tool for a sub loop', () => {
        for (const mode of ['agent', 'chat'] as AgentMode[]) {
            for (const name of names(true, mode)) {
                expect(ToolsManager.getToolDesc(true, mode, name)!.exclusiveInSubLoop).not.toBe(true);
            }
        }
    });

    test('registers exactly the tools the tools folder exports', () => {
        const registered = new Set(CONTEXTS.flatMap(([isSubLoop, mode]) => names(isSubLoop, mode)));
        expect([...registered].sort()).toEqual([...new Set(exportedToolNames())].sort());
    });

    test('offers the project update to the agent of a main loop', () => {
        expect(ToolsManager.getToolDesc(false, 'agent', 'update_project')?.tool.name).toBe('update_project');
    });

    test('gives out a fresh array so callers cannot corrupt the registry', () => {
        const first = ToolsManager.getToolsArray(false, 'agent');
        first.length = 0;
        expect(ToolsManager.getToolsArray(false, 'agent').length).toBeGreaterThan(0);
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
        expect(names(false, 'agent')).toContain(mcpName);
    });

    test('looks a tool up by its prefixed name', () => {
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName)});
        expect(ToolsManager.getToolDesc(false, 'agent', mcpName)?.tool.name).toBe(mcpName);
    });

    test('appends the mcp tools behind the built-in ones', () => {
        const builtIn = names(false, 'agent');
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName)});
        expect(names(false, 'agent')).toEqual([...builtIn, mcpName]);
    });

    test('applies the declared mode to an mcp tool as well', () => {
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName, {agentMode: ['agent']})});
        expect(ToolsManager.getToolDesc(false, 'chat', mcpName)).toBeUndefined();
        expect(names(false, 'chat')).not.toContain(mcpName);
    });

    test('serves an mcp tool that declares the chat mode', () => {
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName, {agentMode: ['agent', 'chat']})});
        expect(ToolsManager.getToolDesc(false, 'chat', mcpName)?.tool.name).toBe(mcpName);
        expect(names(false, 'chat')).toContain(mcpName);
    });

    test('hides an mcp tool that is exclusive to the main loop from sub loops', () => {
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName, {exclusiveInSubLoop: true})});
        expect(ToolsManager.getToolDesc(true, 'agent', mcpName)).toBeUndefined();
        expect(names(true, 'agent')).not.toContain(mcpName);
        expect(ToolsManager.getToolDesc(false, 'agent', mcpName)).toBeDefined();
    });

    test('shares an mcp tool with sub loops by default', () => {
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName)});
        expect(ToolsManager.getToolDesc(true, 'agent', mcpName)?.tool.name).toBe(mcpName);
    });

    test('returns undefined for an mcp name the server does not serve', () => {
        expect(ToolsManager.getToolDesc(false, 'agent', `${MCP_PREFIX}ghost`)).toBeUndefined();
    });

    test('never falls back to a built-in tool for a prefixed name', () => {
        expect(ToolsManager.getToolDesc(false, 'agent', `${MCP_PREFIX}read_file`)).toBeUndefined();
    });

    test('leaves the built-in tools alone while no server is connected', () => {
        const withoutServer = names(false, 'agent');
        mocks.getTools.mockReturnValue({[mcpName]: newMcpTool(mcpName)});
        mocks.getTools.mockReturnValue({});
        expect(names(false, 'agent')).toEqual(withoutServer);
    });
});
