import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolDesc } from '../../definitions/tool-definitions';
import { getLogger, globalize } from '@deepclaw/node-utils';
import { loadConfig } from '@deepclaw/config';

const logger = getLogger('MCPService');
const RETRY_LIMIT = 3;
const RETRY_DELAY_MS = 200;
const MAX_TOOL_NAME_LENGTH = 64;
export const MCP_PREFIX = 'MCP_';

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

    constructor(addr: string) {
        this.addr = addr;
        this.client = new Client({name: addr, version: '1.0.0'}, {capabilities: {}});
        this.transport = new StreamableHTTPClientTransport(new URL(addr));
    }

    public getAddr(): string {
        return this.addr;
    }

    public async connect(): Promise<void> {
        await this.client.connect(this.transport);
        const serverName = this.client.getServerVersion()?.name.replace(/[^a-zA-Z0-9_-]/g, '_')
            || Date.now().toString();
        await this.getToolsFromMCP(serverName);
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
                    parallelSafe: false,
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
        const result = await this.client.callTool({name, arguments: input});
        const parts = Array.isArray(result.content) ? result.content : [];
        const text = parts.map((p: any) =>
            p?.type === 'text' ? p.text : `[${p?.type ?? 'unknown'} content omitted]`
        ).join('\n');
        if (result['isError']) {
            throw new Error(text || `MCP tool ${name} failed`);
        }
        return text;
    }

    public getTools(): Record<string, ToolDesc<any>> {
        return this.tools;
    }

    public close(): Promise<void> {
        return this.client.close();
    }
}

class MCPServiceImpl {
    private static client: MCPClient | undefined;
    private static pending: Promise<void> = Promise.resolve();

    public static connect(): Promise<void> {
        this.pending = this.pending
            .then(() => this.reconnect())
            .catch(error => logger.error(`Failed to connect to MCP server: ${error}`));
        return this.pending;
    }

    private static async reconnect(): Promise<void> {
        const addr = loadConfig<string>('advanced.mcpServer');
        if (this.client) {
            if (addr === this.client.getAddr()) {
                return;
            }
            await this.closeClient();
        }
        if (!addr) {
            return;
        }
        for (let tryCount = 0; tryCount < RETRY_LIMIT; tryCount++) {
            try {
                this.client = await this.connectClient(addr);
                return;
            } catch (error) {
                logger.error(`Failed to connect to MCP server at ${addr}: ${error}`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            }
        }
    }

    private static async closeClient(): Promise<void> {
        const client = this.client;
        this.client = undefined;
        try {
            await client?.close();
        } catch (error) {
            logger.error(`Failed to close MCP client: ${error}`);
        }
    }

    private static async connectClient(addr: string): Promise<MCPClient> {
        const client = new MCPClient(addr);
        await client.connect();
        return client;
    }

    public static getTools(): Record<string, ToolDesc<any>> {
        return this.client?.getTools() || {};
    }
}

export const MCPService = globalize('MCPService', MCPServiceImpl);
