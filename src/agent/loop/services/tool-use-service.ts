import { FileUtils, loadAgentConfig } from '@utils';
import { LLMTool, ToolDesc, ToolUseContext, ToolUseResult } from "../../definitions/tool-definitions.js";

export type ToolUseServiceResult = {
    result: ToolUseResult;
    effect: {
        outputToUser: boolean;
    }
}

export type ToolUseDef = {
    id: string;
    name: string;
    input: unknown;
}

export class ToolUseService {
    private parentSessionId: string;
    private sessionId: string;
    private toolMap: Map<string, ToolDesc> = new Map();
    private truncateThreshold: number = loadAgentConfig<number>('toolResult.truncate.lengthThreshold');
    private persistResultDir: string = loadAgentConfig<string>('toolResult.truncate.persistResultDir');
    private previewChars: number = loadAgentConfig<number>('toolResult.truncate.previewLength');

    constructor(tools: ToolDesc[], parentSessionId: string, sessionId: string) {
        this.parentSessionId = parentSessionId;
        this.sessionId = sessionId;
        for (const tool of tools) {
            this.toolMap.set(tool.tool.name, tool);
        }
    }

    public getAvailableTools(): LLMTool[] {
        return Array.from(this.toolMap.values()).map(t => t.tool)
    }

    public async executeToolCall(toolUseDef: ToolUseDef, context: ToolUseContext): Promise<ToolUseServiceResult> {
        const tool = this.toolMap.get(toolUseDef.name);
        if (!tool) {
            return this.toolResult(toolUseDef.id, `Unknown tool: ${toolUseDef.name}`);
        }
        let input = toolUseDef.input || '{}';
        if (typeof input === 'string') {
            try {
                input = JSON.parse(input);
            } catch (error) {
                return this.toolResult(toolUseDef.id, `Parse input to JSON failed: ${input}. Error: ${error}`);
            }
        }
        if (tool.guard) {
            const {allowed, feedback} = tool.guard(input);
            if (!allowed) {
                return this.toolResult(toolUseDef.id, `Tool run is not allowed: ${toolUseDef.name}. ${feedback}.`);
            }
        }
        try {
            const output = await tool.invoke(input, context);
            return this.toolResult(toolUseDef.id, this.truncateLargeOutput(toolUseDef.id, output), !!tool.outputToUser);
        } catch (error) {
            return this.toolResult(toolUseDef.id, `Error: ${error}`);
        }
    }

    private toolResult(toolUseId: string, content: string, outputToUser: boolean = false): ToolUseServiceResult {
        return ({
            result: {id: toolUseId, content},
            effect: {outputToUser},
        });
    }

    private truncateLargeOutput(toolUseId: string, output: string): string {
        if (output.length <= this.truncateThreshold) {
            return output;
        }
        const fileName = FileUtils.wrapTimestamp(`${toolUseId}.txt`);
        const fullPath = FileUtils.writeFileToSession(this.parentSessionId, this.sessionId, this.persistResultDir, fileName, output);
        output = output.slice(0, this.previewChars);
        return `<persisted-output>
        Full output saved to: ${fullPath}
        Preview:
        ${output}
        </persisted-output>`;
    }
}
