import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolDesc } from '../../definitions/tool-definitions';
import { getLogger, globalize } from '@deepclaw/node-utils';
import { loadConfig } from '@deepclaw/config';

const logger = getLogger('MCPService');
const RETRY_LIMIT = 3;
const RETRY_DELAY_MS = 200;
const RECONNECT_DELAY_MS = 30 * 1000;
const MAX_RECONNECT_DELAY_MS = 5 * 60 * 1000;
/** How long a replaced client may keep its connection open for the calls still running on it. */
const DRAIN_TIMEOUT_MS = 60 * 1000;
const MAX_TOOL_NAME_LENGTH = 64;
export const MCP_PREFIX = 'MCP_';

/** A timer that only waits for a server must never be the reason the process stays alive. */
function backgroundTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(callback, delayMs);
    timer.unref?.();
    return timer;
}

function composeToolName(serverName: string, toolName: string): string {
    const room = MAX_TOOL_NAME_LENGTH - MCP_PREFIX.length - toolName.length - 1;
    if (room <= 0) {
        return `${MCP_PREFIX}${toolName}`.substring(0, MAX_TOOL_NAME_LENGTH);
    }
    return `${MCP_PREFIX}${serverName.substring(0, room)}_${toolName}`;
}

class MCPClient {
    private addr: string;
    private client: Client;
    private transport: StreamableHTTPClientTransport;
    private tools: Record<string, ToolDesc<any>> = {};
    private inFlight = 0;
    private retired = false;
    private closed = false;
    private lost = false;
    private drainTimer: ReturnType<typeof setTimeout> | undefined;
    private readonly onLost: () => void;

    constructor(addr: string, onLost: () => void = () => undefined) {
        this.addr = addr;
        this.onLost = onLost;
        this.client = new Client({name: addr, version: '1.0.0'}, {capabilities: {}});
        this.transport = new StreamableHTTPClientTransport(new URL(addr));
    }

    public getAddr(): string {
        return this.addr;
    }

    /** A connection that died on its own is of no use, and its tools are not there anymore. */
    public isLost(): boolean {
        return this.lost;
    }

    public async connect(): Promise<void> {
        await this.client.connect(this.transport);
        // Nothing else says that a server went away between two tool calls.
        this.client.onclose = () => this.markLost();
        const serverName = this.client.getServerVersion()?.name.replace(/[^a-zA-Z0-9_-]/g, '_')
            || Date.now().toString();
        await this.getToolsFromMCP(serverName);
    }

    /** Closing the client is what retiring it does, so only a close nobody asked for counts. */
    private markLost(): void {
        if (this.closed || this.retired || this.lost) {
            return;
        }
        this.lost = true;
        this.onLost();
    }

    private async getToolsFromMCP(serverName: string): Promise<void> {
        let cursor: string | undefined;
        do {
            const result = await this.client.listTools(cursor ? {cursor} : undefined);
            for (const tool of result.tools) {
                const name = composeToolName(serverName, tool.name);
                this.tools[name] = {
                    tool: {
                        name,
                        description: tool.description ?? tool.title ?? '',
                        schema: tool.inputSchema,
                    },
                    parallelSafe: true,
                    agentMode: ['agent'],
                    exclusiveInSubLoop: false,
                    invoke: async (input: any) => {
                        return await this.callTool(tool.name, input);
                    },
                };
            }
            cursor = result.nextCursor;
        } while (cursor);
    }

    public async callTool(name: string, input: any): Promise<string> {
        if (this.retired) {
            throw new Error(`MCP server changed while ${name} was pending, call the tool again`);
        }
        this.inFlight++;
        try {
            const result = await this.client.callTool({name, arguments: input});
            const parts = Array.isArray(result.content) ? result.content : [];
            const text = parts.map((p: any) =>
                p?.type === 'text' ? p.text : `[${p?.type ?? 'unknown'} content omitted]`
            ).join('\n');
            if (result['isError']) {
                throw new Error(text || `MCP tool ${name} failed`);
            }
            return text;
        } finally {
            this.inFlight--;
            if (this.retired && this.inFlight === 0) {
                this.closeQuietly();
            }
        }
    }

    public getTools(): Record<string, ToolDesc<any>> {
        return this.tools;
    }

    /**
     * Takes the client out of service without cutting the calls that are already running on it:
     * they keep the old connection until they answer, or until the drain timeout gives up on them.
     */
    public retire(): Promise<void> {
        this.retired = true;
        if (this.inFlight === 0) {
            return this.close();
        }
        this.drainTimer = backgroundTimer(() => this.closeQuietly(), DRAIN_TIMEOUT_MS);
        return Promise.resolve();
    }

    public async close(): Promise<void> {
        if (this.drainTimer) {
            clearTimeout(this.drainTimer);
            this.drainTimer = undefined;
        }
        if (this.closed) {
            return;
        }
        this.closed = true;
        await this.client.close();
    }

    private closeQuietly(): void {
        this.close().catch(error => logger.error(`Failed to close MCP client ${this.addr}: ${error}`));
    }
}

class MCPServiceImpl {
    private static client: MCPClient | undefined;
    private static pending: Promise<void> = Promise.resolve();
    private static retryTimer: ReturnType<typeof setTimeout> | undefined;
    private static retryDelay = RECONNECT_DELAY_MS;

    /** An explicit connect is a fresh start: it drops the backoff the retries built up. */
    public static connect(): Promise<void> {
        this.retryDelay = RECONNECT_DELAY_MS;
        return this.enqueueReconnect();
    }

    private static enqueueReconnect(): Promise<void> {
        this.pending = this.pending
            .then(() => this.reconnect())
            .catch(error => logger.error(`Failed to connect to MCP server: ${error}`));
        return this.pending;
    }

    private static async reconnect(): Promise<void> {
        this.cancelRetry();
        const addr = loadConfig<string>('advanced.mcpServer');
        if (this.client && !this.client.isLost() && addr === this.client.getAddr()) {
            return;
        }
        if (!addr) {
            await this.retire(this.takeClient());
            return;
        }
        // The running client stays in charge until the new one answered, so a config change never
        // leaves the agents without their mcp tools while the new connection is being built.
        const connected = await this.connectClient(addr);
        const previous = this.client;
        this.client = connected;
        await this.retire(previous);
        if (!connected) {
            this.scheduleRetry(addr);
            return;
        }
        this.retryDelay = RECONNECT_DELAY_MS;
    }

    private static takeClient(): MCPClient | undefined {
        const client = this.client;
        this.client = undefined;
        return client;
    }

    private static async retire(client: MCPClient | undefined): Promise<void> {
        try {
            await client?.retire();
        } catch (error) {
            logger.error(`Failed to close MCP client: ${error}`);
        }
    }

    private static async connectClient(addr: string): Promise<MCPClient | undefined> {
        for (let tryCount = 0; tryCount < RETRY_LIMIT; tryCount++) {
            try {
                const client: MCPClient = new MCPClient(addr, () => this.onClientLost(client));
                await client.connect();
                return client;
            } catch (error) {
                logger.error(`Failed to connect to MCP server at ${addr}: ${error}`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            }
        }
        return undefined;
    }

    /**
     * The config still asks for that server, so a connection that dropped is built again right
     * away; only if the server is really gone does this fall back to the slow retry.
     */
    private static onClientLost(client: MCPClient): void {
        if (this.client !== client) {
            return;
        }
        logger.warn(`MCP server ${client.getAddr()} dropped the connection, connecting again`);
        void this.connect();
    }

    /** Without this the tools of an unreachable server stay gone until someone saves the config. */
    private static scheduleRetry(addr: string): void {
        logger.warn(`Giving up on MCP server ${addr} for now, retrying in ${this.retryDelay}ms`);
        this.retryTimer = backgroundTimer(() => {
            this.retryTimer = undefined;
            void this.enqueueReconnect();
        }, this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, MAX_RECONNECT_DELAY_MS);
    }

    private static cancelRetry(): void {
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = undefined;
        }
    }

    public static getTools(): Record<string, ToolDesc<any>> {
        return this.client?.getTools() || {};
    }
}

export const MCPService = globalize('MCPService', MCPServiceImpl);
