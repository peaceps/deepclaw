import { FileUtils, loadAgentConfig } from '@utils';
import { ToolDesc, ToolUseContext, ToolUseResult } from "../../definitions/tool-definitions.js";
import { AgentEvent } from '@core';

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

type AgentEventEmitter = {
    emit: (event: AgentEvent) => Promise<string>;
}

const TOOL_RESULT_PERSIST_DIR = 'tool_results';

export class ToolUseService {
    private parentSessionId: string;
    private sessionId: string;
    private toolMap: Map<string, ToolDesc> = new Map();
    private eventEmitter: AgentEventEmitter;
    private truncateThreshold: number = loadAgentConfig<number>('toolResult.truncate.lengthThreshold');
    private previewChars: number = loadAgentConfig<number>('toolResult.truncate.previewLength');

    constructor(
        tools: ToolDesc[],
        parentSessionId: string,
        sessionId: string,
        eventEmitter: AgentEventEmitter
    ) {
        this.parentSessionId = parentSessionId;
        this.sessionId = sessionId;
        for (const tool of tools) {
            this.toolMap.set(tool.tool.name, tool);
        }
        this.eventEmitter = eventEmitter;
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
            const guardResult = tool.guard(input);
            if (guardResult.result === 'denied') {
                return this.toolResult(toolUseDef.id, `Tool run is not allowed: ${toolUseDef.name}. ${guardResult.reason}.`);
            } else if (guardResult.result === 'ask') {
                const choice = await this.eventEmitter.emit({type: 'input', content: guardResult.question || ''});
                if (!guardResult.checkAnswer(choice)) {
                    return this.toolResult(toolUseDef.id, `Execution of tool ${tool.tool.name} is rejected by user.`)
                }
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
        const fullPath = FileUtils.writeFileToSession(this.parentSessionId, this.sessionId, TOOL_RESULT_PERSIST_DIR, fileName, output);
        output = output.slice(0, this.previewChars);
        return `<persisted-output>
        Full output saved to: ${fullPath}
        Preview:
        ${output}
        </persisted-output>`;
    }
}
