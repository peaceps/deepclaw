import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const server = new McpServer({
    name: 'test-mcp-server',
    version: '1.0.0',
});

server.registerTool(
    'add',
    {
        description: 'add numbers',
        inputSchema: {
            a: z.number().describe('first number'),
            b: z.number().describe('second number'),
        },
    },
    async ({ a, b }) => {
        const sum = a + b;
        return {
            content: [{ type: 'text', text: `${a} + ${b} = ${sum}` }],
        };
    }
);

const app = express();
app.use(express.json());

app.post('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
    });
    res.on('close', () => {
        void transport.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
});

const PORT = 6059;
app.listen(PORT, () => {
    console.log(`MCP HTTP server listening on port ${PORT}`);
    console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
