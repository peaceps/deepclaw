import {beforeEach, describe, expect, test, vi} from 'vitest';
import {newTestContext} from '../../../test-support/one-loop-context';
import {MCPService, MCP_PREFIX} from './mcp-service';

type McpTool = {name: string; description?: string; title?: string; inputSchema?: unknown};

type CallToolResult = {content?: unknown; isError?: boolean};

const ADDR = 'http://localhost:3000/mcp';
const OTHER_ADDR = 'http://localhost:4000/mcp';
const RETRY_LIMIT = 3;
const RETRY_DELAY_MS = 200;
const RECONNECT_DELAY_MS = 30 * 1000;
const DRAIN_TIMEOUT_MS = 60 * 1000;

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
    callTool: vi.fn<(
        params: {name: string; arguments: unknown},
        resultSchema?: unknown,
        options?: {signal?: AbortSignal},
    ) => Promise<CallToolResult>>(
        async () => ({content: []})
    ),
    /** Every client that was built, so that a test can drop the connection of one of them. */
    clients: [] as {onclose: (() => void) | undefined}[],
}));

vi.mock('@modelcontextprotocol/sdk/client', () => ({
    Client: class FakeClient {
        public connect = mocks.connect;
        public close = mocks.close;
        public getServerVersion = mocks.serverVersion;
        public listTools = mocks.listTools;
        public callTool = mocks.callTool;
        public onclose: (() => void) | undefined = undefined;

        constructor(...args: [unknown, unknown]) {
            mocks.newClient(args[0]);
            mocks.clients.push(this);
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
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.clients.length = 0;
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

/** Lets every pending promise callback run. */
function flush(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

async function invokeTool(
    name: string, input: unknown, abortSignal?: AbortSignal
): Promise<string> {
    const tool = MCPService.getTools()[name];
    if (!tool) {
        throw new Error(`Tool ${name} was not exposed. Available: ${toolNames().join(', ')}`);
    }
    return tool.invoke(input, newTestContext({abortSignal}));
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

    test('closes the old client once the new address answered', async () => {
        await connectTo(ADDR);
        await connectTo(OTHER_ADDR);
        expect(mocks.close).toHaveBeenCalledOnce();
        expect(mocks.newTransport.mock.calls[1]![0].href).toBe(OTHER_ADDR);
        expect(mocks.connect).toHaveBeenCalledTimes(2);
    });

    test('keeps serving the tools of the old server while the new one connects', async () => {
        await connectTo(ADDR, [{name: 'ping'}]);
        let letConnect = () => undefined as void;
        mocks.connect.mockImplementationOnce(() => new Promise(resolve => {
            letConnect = () => resolve();
        }));
        mocks.loadConfig.mockReturnValue(OTHER_ADDR);
        mocks.listTools.mockResolvedValue({tools: [{name: 'pong'}]});

        const connecting = MCPService.connect();
        await flush();
        expect(toolNames()).toEqual(['MCP_srv_ping']);
        expect(mocks.close).not.toHaveBeenCalled();

        letConnect();
        await connecting;
        expect(toolNames()).toEqual(['MCP_srv_pong']);
    });

    test('gives up the old tools when the new address cannot be reached', async () => {
        await connectTo(ADDR, [{name: 'ping'}]);
        mocks.connect.mockRejectedValue(new Error('refused'));
        await connectTo(OTHER_ADDR);
        expect(MCPService.getTools()).toEqual({});
        expect(mocks.close).toHaveBeenCalledOnce();
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
        expect(order).toEqual(['connect', 'connect', 'close']);
        expect(mocks.newTransport.mock.calls.map(([url]) => url.href)).toEqual([ADDR, OTHER_ADDR]);
    });

    test('keeps trying in the background after it gave up on the server', async () => {
        vi.useFakeTimers();
        mocks.connect.mockRejectedValue(new Error('refused'));
        mocks.loadConfig.mockReturnValue(ADDR);
        const givingUp = MCPService.connect();
        await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * RETRY_LIMIT);
        await givingUp;
        expect(mocks.connect).toHaveBeenCalledTimes(RETRY_LIMIT);

        mocks.connect.mockResolvedValue(undefined);
        mocks.listTools.mockResolvedValue({tools: [{name: 'ping'}]});
        await vi.advanceTimersByTimeAsync(RECONNECT_DELAY_MS);
        expect(toolNames()).toEqual(['MCP_srv_ping']);
    });

    test('stops the background retry once the server is removed from the config', async () => {
        vi.useFakeTimers();
        mocks.connect.mockRejectedValue(new Error('refused'));
        mocks.loadConfig.mockReturnValue(ADDR);
        const givingUp = MCPService.connect();
        await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * RETRY_LIMIT);
        await givingUp;

        mocks.loadConfig.mockReturnValue('');
        await MCPService.connect();
        mocks.connect.mockClear();
        await vi.advanceTimersByTimeAsync(RECONNECT_DELAY_MS * 10);
        expect(mocks.connect).not.toHaveBeenCalled();
    });
});

describe('a connection that dropped on its own', () => {

    /** The client the service is serving the tools of, as the sdk hands it the close event. */
    function lastClient(): {onclose: (() => void) | undefined} {
        return mocks.clients[mocks.clients.length - 1]!;
    }

    test('is built again while the config still asks for that server', async () => {
        await connectTo(ADDR, [{name: 'ping'}]);
        const dropped = lastClient();
        mocks.listTools.mockResolvedValue({tools: [{name: 'pong'}]});

        dropped.onclose!();
        await MCPService.connect();

        expect(mocks.connect).toHaveBeenCalledTimes(2);
        expect(toolNames()).toEqual(['MCP_srv_pong']);
    });

    test('leaves no tools behind when the server stays unreachable', async () => {
        await connectTo(ADDR, [{name: 'ping'}]);
        const dropped = lastClient();
        mocks.connect.mockRejectedValue(new Error('refused'));
        vi.useFakeTimers();

        dropped.onclose!();
        await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * RETRY_LIMIT);

        expect(MCPService.getTools()).toEqual({});
    });

    test('is not built again when the service closed it on purpose', async () => {
        await connectTo(ADDR, [{name: 'ping'}]);
        const retired = lastClient();
        mocks.loadConfig.mockReturnValue('');
        await MCPService.connect();
        mocks.connect.mockClear();

        retired.onclose!();
        await flush();

        expect(mocks.connect).not.toHaveBeenCalled();
        expect(MCPService.getTools()).toEqual({});
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

    test('marks every tool as agent only and parallel safe', async () => {
        await connectTo(ADDR, [{name: 'ping'}]);
        const tool = MCPService.getTools()['MCP_srv_ping']!;
        expect(tool.parallelSafe).toBe(true);
        expect(tool.agentMode).toEqual(['agent']);
        expect(tool.loopKinds).toBeUndefined();
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
        expect(mocks.callTool)
            .toHaveBeenCalledExactlyOnceWith({name: 'ping', arguments: {q: 'hello'}}, undefined, {signal: undefined});
    });

    /**
     * The registration closure used to drop the context it was handed, which left every call of
     * every MCP tool waiting out a server that had stopped answering.
     */
    test('calls under the signal of the run that asked for the tool', async () => {
        const abortSignal = new AbortController().signal;
        await invokeTool('MCP_srv_ping', {q: 'hello'}, abortSignal);
        expect(mocks.callTool.mock.calls[0]![2]).toEqual({signal: abortSignal});
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

describe('callTool while the client is replaced', () => {

    /** Resolves the pending call the tool made, and hands over the promise of that call. */
    function callInFlight(): {answer: (text: string) => void; result: Promise<string>} {
        let answer: (text: string) => void = () => undefined;
        mocks.callTool.mockImplementationOnce(() => new Promise(resolve => {
            answer = (text: string) => resolve({content: [{type: 'text', text}]});
        }));
        return {answer: (text: string) => answer(text), result: invokeTool('MCP_srv_ping', {})};
    }

    beforeEach(async () => {
        await connectTo(ADDR, [{name: 'ping'}]);
    });

    test('keeps the old connection open until the running call answered', async () => {
        const {answer, result} = callInFlight();
        await flush();
        await connectTo(OTHER_ADDR, [{name: 'pong'}]);
        expect(mocks.close).not.toHaveBeenCalled();

        answer('late but complete');
        await expect(result).resolves.toBe('late but complete');
        await flush();
        expect(mocks.close).toHaveBeenCalledOnce();
    });

    test('drops the old connection when the running call overstays the drain timeout', async () => {
        callInFlight();
        await flush();
        vi.useFakeTimers();
        await connectTo(OTHER_ADDR, [{name: 'pong'}]);
        expect(mocks.close).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(DRAIN_TIMEOUT_MS);
        expect(mocks.close).toHaveBeenCalledOnce();
    });

    test('refuses a call handed out before the server was replaced', async () => {
        const stale = MCPService.getTools()['MCP_srv_ping']!;
        await connectTo(OTHER_ADDR, [{name: 'pong'}]);
        await expect(stale.invoke({}, newTestContext()))
            .rejects.toThrow('MCP server changed while ping was pending, call the tool again');
        expect(mocks.callTool).not.toHaveBeenCalled();
    });
});
