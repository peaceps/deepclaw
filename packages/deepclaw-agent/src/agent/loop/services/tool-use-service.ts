import { FileUtils } from '@deepclaw/node-utils';
import { ToolDesc, ToolUseResult } from "../../definitions/tool-definitions";
import { type SealedAgentHandler } from '@deepclaw/core';
import { OneLoopContext } from '../../definitions/definitions';
import { SESSION_DIR, AGENTS_DIR, TOOL_RESULT_DIR } from '../../paths';

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
    private agentId: string;
    private parentSessionId: string;
    private sessionId: string;
    private toolMap: Map<string, ToolDesc> = new Map();
    private agentHandler: SealedAgentHandler;
    private truncateThreshold: number = 20000;
    private previewChars: number = 1000;

    constructor(
        tools: ToolDesc[],
        agentId: string,
        parentSessionId: string,
        sessionId: string,
        agentHandler: SealedAgentHandler
    ) {
        this.agentId = agentId;
        this.parentSessionId = parentSessionId;
        this.sessionId = sessionId;
        for (const tool of tools) {
            this.toolMap.set(tool.tool.name, tool);
        }
        this.agentHandler = agentHandler;
    }

    public updateTools(tools: ToolDesc[]) {
        this.toolMap.clear();
        for (const tool of tools) {
            this.toolMap.set(tool.tool.name, tool);
        }
    }

    public async executeToolCall(toolUseDef: ToolUseDef, context: OneLoopContext): Promise<ToolUseServiceResult> {
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
            const guardResult = tool.guard(input, context.loopConfig.mode);
            if (guardResult.result === 'denied') {
                return this.toolResult(toolUseDef.id, `Tool run is not allowed: ${toolUseDef.name}. ${guardResult.reason}.`);
            } else if (guardResult.result === 'ask') {
                const choice = await this.agentHandler.onInteractionEvent({type: 'input', content: guardResult.question || ''});
                if (!guardResult.checkAnswer(choice as string)) {
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
        const fullPath = `${AGENTS_DIR}/${this.agentId}/${SESSION_DIR}/${this.parentSessionId}/${this.sessionId}/${TOOL_RESULT_DIR}/${fileName}`;
        FileUtils.writeFile(fullPath, output);
        output = output.slice(0, this.previewChars);
        return `<persisted-output>
        Full output saved to: ${fullPath}
        Preview:
        ${output}
        </persisted-output>`;
    }
}
