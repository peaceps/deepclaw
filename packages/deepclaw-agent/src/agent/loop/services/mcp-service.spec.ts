import {beforeEach, describe, expect, test, vi} from 'vitest';
import {newTestContext} from '../../../test-support/one-loop-context';
import {MCPService, MCP_PREFIX} from './mcp-service';

type McpTool = {name: string; description?: string; title?: string; inputSchema?: unknown};

type CallToolResult = {content?: unknown; isError?: boolean};

const ADDR = 'http://localhost:3000/mcp';
const OTHER_ADDR = 'http://localhost:4000/mcp';

const mocks = vi.hoisted(() => ({
    loadConfig: vi.fn<(key: string) => string>(() => ''),
    newClient: vi.fn<(info: unknown) => void>(() => undefined),
    newTransport: vi.fn<(url: URL) => void>(() => undefined),
    connect: vi.fn<(transport: unknown) => Promise<void>>(async () => undefined),
    close: vi.fn<() => Promise<void>>(async () => undefined),
    serverVersion: vi.fn<() => {name: string; version: string} | undefined>(
        () => ({name: 'srv', version: '1.0.0'})
    ),
    listTools: vi.fn<(params?: {cursor: string}) => Promise<{tools: McpTool[]; nextCursor?: string}>>(
        async () => ({tools: []})
    ),
    callTool: vi.fn<(params: {name: string; arguments: unknown}) => Promise<CallToolResult>>(
        async () => ({content: []})
    ),
}));

vi.mock('@modelcontextprotocol/sdk/client', () => ({
    Client: class FakeClient {
        public connect = mocks.connect;
        public close = mocks.close;
        public getServerVersion = mocks.serverVersion;
        public listTools = mocks.listTools;
        public callTool = mocks.callTool;

        constructor(...args: [unknown, unknown]) {
            mocks.newClient(args[0]);
        }
    },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
    StreamableHTTPClientTransport: class FakeTransport {
        constructor(...args: [URL]) {
            mocks.newTransport(args[0]);
        }
    },
}));

vi.mock('@deepclaw/config', () => ({loadConfig: mocks.loadConfig}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    getLoopLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

function primeMocks(): void {
    vi.clearAllMocks();
    mocks.loadConfig.mockReturnValue('');
    mocks.connect.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);
    mocks.serverVersion.mockReturnValue({name: 'srv', version: '1.0.0'});
    mocks.listTools.mockResolvedValue({tools: []});
    mocks.callTool.mockResolvedValue({content: []});
}

async function connectTo(addr: string, tools: McpTool[] = []): Promise<void> {
    mocks.loadConfig.mockReturnValue(addr);
    mocks.listTools.mockResolvedValue({tools});
    await MCPService.connect();
}

function toolNames(): string[] {
    return Object.keys(MCPService.getTools());
}

async function invokeTool(name: string, input: unknown): Promise<string> {
    const tool = MCPService.getTools()[name];
    if (!tool) {
        throw new Error(`Tool ${name} was not exposed. Available: ${toolNames().join(', ')}`);
    }
    return tool.invoke(input, newTestContext());
}

/** The service is a globalized singleton, so the client of the previous test is released first. */
beforeEach(async () => {
    primeMocks();
    await MCPService.connect();
    primeMocks();
});

describe('connect', () => {

    test('stays idle when no mcp server is configured', async () => {
        await MCPService.connect();
        expect(mocks.loadConfig).toHaveBeenCalledWith('advanced.mcpServer');
        expect(mocks.newClient).not.toHaveBeenCalled();
        expect(MCPService.getTools()).toEqual({});
    });

    test('creates a client and a streamable http transport for the configured address', async () => {
        await connectTo(ADDR);
        expect(mocks.newClient).toHaveBeenCalledExactlyOnceWith({name: ADDR, version: '1.0.0'});
        expect(mocks.newTransport).toHaveBeenCalledOnce();
        expect(mocks.newTransport.mock.calls[0]![0].href).toBe(ADDR);
        expect(mocks.connect).toHaveBeenCalledOnce();
    });

    test('never rejects, even when the server cannot be reached', async () => {
        mocks.connect.mockRejectedValue(new Error('refused'));
        mocks.loadConfig.mockReturnValue(ADDR);
        await expect(MCPService.connect()).resolves.toBeUndefined();
    });

    test('reuses the client when the address did not change', async () => {
        await connectTo(ADDR, [{name: 'ping'}]);
        await MCPService.connect();
        expect(mocks.connect).toHaveBeenCalledOnce();
        expect(mocks.close).not.toHaveBeenCalled();
        expect(toolNames()).toEqual(['MCP_srv_ping']);
    });

    test('closes the old client before connecting to a new address', async () => {
        await connectTo(ADDR);
        await connectTo(OTHER_ADDR);
        expect(mocks.close).toHaveBeenCalledOnce();
        expect(mocks.newTransport.mock.calls[1]![0].href).toBe(OTHER_ADDR);
        expect(mocks.connect).toHaveBeenCalledTimes(2);
    });

    test('drops the client when the server is removed from the config', async () => {
        await connectTo(ADDR, [{name: 'ping'}]);
        mocks.loadConfig.mockReturnValue('');
        await MCPService.connect();
        expect(mocks.close).toHaveBeenCalledOnce();
        expect(MCPService.getTools()).toEqual({});
    });

    test('connects to the new address even when closing the old client throws', async () => {
        await connectTo(ADDR);
        mocks.close.mockRejectedValue(new Error('socket stuck'));
        await connectTo(OTHER_ADDR, [{name: 'ping'}]);
        expect(toolNames()).toEqual(['MCP_srv_ping']);
    });

    test('retries three times before giving up', async () => {
        mocks.connect.mockRejectedValue(new Error('refused'));
        await connectTo(ADDR);
        expect(mocks.connect).toHaveBeenCalledTimes(3);
        expect(MCPService.getTools()).toEqual({});
    });

    test('stops retrying as soon as a connect succeeds', async () => {
        mocks.connect.mockRejectedValueOnce(new Error('refused'));
        await connectTo(ADDR, [{name: 'ping'}]);
        expect(mocks.connect).toHaveBeenCalledTimes(2);
        expect(toolNames()).toEqual(['MCP_srv_ping']);
    });

    test('serializes two concurrent connects instead of interleaving them', async () => {
        const order: string[] = [];
        mocks.connect.mockImplementation(async () => {
            order.push('connect');
        });
        mocks.close.mockImplementation(async () => {
            order.push('close');
        });
        mocks.loadConfig.mockReturnValueOnce(ADDR).mockReturnValue(OTHER_ADDR);
        await Promise.all([MCPService.connect(), MCPService.connect()]);
        expect(order).toEqual(['connect', 'close', 'connect']);
        expect(mocks.newTransport.mock.calls.map(([url]) => url.href)).toEqual([ADDR, OTHER_ADDR]);
    });
});

describe('tool names', () => {

    test('exports the prefix every mcp tool carries', () => {
        expect(MCP_PREFIX).toBe('MCP_');
    });

    test('joins the prefix, the server name and the tool name', async () => {
        await connectTo(ADDR, [{name: 'ping'}]);
        expect(toolNames()).toEqual(['MCP_srv_ping']);
    });

    test('replaces characters a tool name may not contain', async () => {
        mocks.serverVersion.mockReturnValue({name: 'my server!', version: '1.0.0'});
        await connectTo(ADDR, [{name: 'ping'}]);
        expect(toolNames()).toEqual(['MCP_my_server__ping']);
    });

    test('falls back to a timestamp when the server reports no version', async () => {
        mocks.serverVersion.mockReturnValue(undefined);
        await connectTo(ADDR, [{name: 'ping'}]);
        expect(toolNames()[0]).toMatch(/^MCP_\d+_ping$/);
    });

    test('shortens a long server name so the name fits into 64 characters', async () => {
        mocks.serverVersion.mockReturnValue({name: 'a'.repeat(100), version: '1.0.0'});
        await connectTo(ADDR, [{name: 'ping'}]);
        const [name] = toolNames();
        expect(name).toHaveLength(64);
        expect(name).toBe(`MCP_${'a'.repeat(55)}_ping`);
    });

    test('drops the server name when the tool name alone fills the limit', async () => {
        mocks.serverVersion.mockReturnValue({name: 'srv', version: '1.0.0'});
        await connectTo(ADDR, [{name: 'b'.repeat(70)}]);
        expect(toolNames()).toEqual([`MCP_${'b'.repeat(60)}`]);
    });

    test('drops the server name when there is no room left for the separator', async () => {
        await connectTo(ADDR, [{name: 'c'.repeat(59)}]);
        expect(toolNames()).toEqual([`MCP_${'c'.repeat(59)}`]);
    });

    test('keeps the shortest possible server name when a single character fits', async () => {
        await connectTo(ADDR, [{name: 'd'.repeat(58)}]);
        expect(toolNames()).toEqual([`MCP_s_${'d'.repeat(58)}`]);
    });
});

describe('tool listing', () => {

    test('exposes the description and the schema of a tool', async () => {
        const schema = {type: 'object', properties: {q: {type: 'string'}}};
        await connectTo(ADDR, [{name: 'ping', description: 'pings', inputSchema: schema}]);
        expect(MCPService.getTools()['MCP_srv_ping']!.tool).toEqual({
            name: 'MCP_srv_ping', description: 'pings', schema,
        });
    });

    test('falls back to the title when the tool has no description', async () => {
        await connectTo(ADDR, [{name: 'ping', title: 'Ping'}]);
        expect(MCPService.getTools()['MCP_srv_ping']!.tool.description).toBe('Ping');
    });

    test('leaves the description empty when neither is given', async () => {
        await connectTo(ADDR, [{name: 'ping'}]);
        expect(MCPService.getTools()['MCP_srv_ping']!.tool.description).toBe('');
    });

    test('marks every tool as agent only and not parallel safe', async () => {
        await connectTo(ADDR, [{name: 'ping'}]);
        const tool = MCPService.getTools()['MCP_srv_ping']!;
        expect(tool.parallelSafe).toBe(false);
        expect(tool.agentMode).toEqual(['agent']);
        expect(tool.exclusiveInSubLoop).toBe(false);
    });

    test('follows the cursor until the server stops paging', async () => {
        mocks.loadConfig.mockReturnValue(ADDR);
        mocks.listTools
            .mockResolvedValueOnce({tools: [{name: 'first'}], nextCursor: 'page2'})
            .mockResolvedValueOnce({tools: [{name: 'second'}]});
        await MCPService.connect();
        expect(mocks.listTools).toHaveBeenCalledTimes(2);
        expect(mocks.listTools.mock.calls[0]![0]).toBeUndefined();
        expect(mocks.listTools.mock.calls[1]![0]).toEqual({cursor: 'page2'});
        expect(toolNames()).toEqual(['MCP_srv_first', 'MCP_srv_second']);
    });

    test('reports no tools while nothing is connected', () => {
        expect(MCPService.getTools()).toEqual({});
    });
});

describe('callTool', () => {

    beforeEach(async () => {
        await connectTo(ADDR, [{name: 'ping'}]);
    });

    test('sends the original tool name and the given input', async () => {
        await invokeTool('MCP_srv_ping', {q: 'hello'});
        expect(mocks.callTool).toHaveBeenCalledExactlyOnceWith({name: 'ping', arguments: {q: 'hello'}});
    });

    test('joins every text part with a line break', async () => {
        mocks.callTool.mockResolvedValue({content: [{type: 'text', text: 'one'}, {type: 'text', text: 'two'}]});
        await expect(invokeTool('MCP_srv_ping', {})).resolves.toBe('one\ntwo');
    });

    test('replaces a part that is not text with a placeholder', async () => {
        mocks.callTool.mockResolvedValue({content: [{type: 'text', text: 'shot'}, {type: 'image', data: 'x'}]});
        await expect(invokeTool('MCP_srv_ping', {})).resolves.toBe('shot\n[image content omitted]');
    });

    test('labels a part without a type as unknown', async () => {
        mocks.callTool.mockResolvedValue({content: [{}]});
        await expect(invokeTool('MCP_srv_ping', {})).resolves.toBe('[unknown content omitted]');
    });

    test('returns an empty string when the result carries no content list', async () => {
        mocks.callTool.mockResolvedValue({});
        await expect(invokeTool('MCP_srv_ping', {})).resolves.toBe('');
    });

    test('turns a flagged error into a thrown error with the server text', async () => {
        mocks.callTool.mockResolvedValue({content: [{type: 'text', text: 'no such file'}], isError: true});
        await expect(invokeTool('MCP_srv_ping', {})).rejects.toThrow('no such file');
    });

    test('throws a generic error when the failure carries no text', async () => {
        mocks.callTool.mockResolvedValue({content: [], isError: true});
        await expect(invokeTool('MCP_srv_ping', {})).rejects.toThrow('MCP tool ping failed');
    });

    test('lets a failure of the transport bubble up', async () => {
        mocks.callTool.mockRejectedValue(new Error('connection lost'));
        await expect(invokeTool('MCP_srv_ping', {})).rejects.toThrow('connection lost');
    });
});
