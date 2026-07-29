import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolDesc } from '../../definitions/tool-definitions';
import { getLogger, globalize } from '@deepclaw/node-utils';
import { loadConfig } from '@deepclaw/config';

const logger = getLogger('MCPService');
const RETRY_LIMIT = 3;
export const MCP_PREFIX = 'MCP_';

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

    public getAddr(): string | undefined {
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
                const name = `${MCP_PREFIX}${serverName}_${tool.name}`.substring(0, 64);
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

export class MCPServiceImpl {
    private static client: MCPClient | undefined;

    public static async connect(): Promise<void> {
        const addr = loadConfig<string>('advanced.mcpServer');
        if (this.client) {
            if (addr !== this.client?.getAddr()) {
                await this.client?.close();
                this.client = undefined;
            } else {
                return;
            }
        }
        if (!addr) {
            return;
        }
        let tryCount = 0;
        while (tryCount < RETRY_LIMIT) {
            try {
                this.client = await this.connectClient(addr);
                break;
            } catch (error) {
                logger.error(`Failed to connect to MCP server at ${addr}: ${error}`);
                tryCount++;
                await new Promise(resolve => setTimeout(resolve, 200));
            }
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
