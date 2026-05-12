import path from 'path';
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
    private sessionId: string;
    private toolMap: Map<string, ToolDesc> = new Map();
    private sessionDir: string = loadAgentConfig<string>('sessionDir');
    private truncateThreshold: number = loadAgentConfig<number>('toolResult.truncate.lengthThreshold');
    private persistResultDir: string = loadAgentConfig<string>('toolResult.truncate.persistResultDir');
    private previewChars: number = loadAgentConfig<number>('toolResult.truncate.previewLength');

    constructor(tools: ToolDesc[], sessionId: string) {
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
        if (tool.guard) {
            const {allowed, feedback} = tool.guard(toolUseDef.input);
            if (!allowed) {
                return this.toolResult(toolUseDef.id, `Tool run is not allowed: ${toolUseDef.name}. ${feedback}.`);
            }
        }
        try {
            const output = await tool.invoke(toolUseDef.input, context);
            return this.toolResult(toolUseDef.id, this.persistLargeOutput(toolUseDef.id, output), !!tool.outputToUser);
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

    private persistLargeOutput(toolUseId: string, output: string): string {
        if (output.length <= this.truncateThreshold) {
            return output;
        }
        const persistFileName = `${new Date().toISOString().replace(/[\-TZ\.:]/g, '')}_${toolUseId}.txt`;
        const persistFilePath = path.join(this.sessionDir, this.sessionId, this.persistResultDir, persistFileName);
        FileUtils.writeFile(persistFilePath, output);
        output = output.slice(0, this.previewChars);
        return `<persisted-output>
            Full output saved to: ${persistFilePath}
            Preview:
            ${output}
            </persisted-output>
        `;
    }
}
