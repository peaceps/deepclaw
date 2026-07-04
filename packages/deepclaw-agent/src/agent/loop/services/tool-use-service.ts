import { FileUtils } from '@deepclaw/node-utils';
import { ToolUseResult, ToolUseDef } from "../../definitions/tool-definitions";
import { OneLoopContext } from '../../definitions/definitions';
import { TOOL_RESULT_DIR } from '../../paths';
import { ToolsManager } from './tools-manager';
import { HookManager } from './hook-manager';

export type ToolUseServiceResult = {
    result: ToolUseResult;
    success: boolean;
}

const TRUNCATE_THRESHOLD = 20000;
const PREVIEW_CHAR_LENGTH = 1000;

export class ToolUseService {

    public static async executeToolCall(toolUseDef: ToolUseDef, context: OneLoopContext): Promise<ToolUseServiceResult> {
        const tool = ToolsManager.getToolDesc(context.isSubLoop, context.loopConfig.mode, toolUseDef.name);
        if (!tool) {
            return this.toolResult(toolUseDef.id, `Unknown tool: ${toolUseDef.name}`, false);
        }
        let input = toolUseDef.input || '{}';
        if (typeof input === 'string') {
            try {
                input = JSON.parse(input);
            } catch (error) {
                return this.toolResult(toolUseDef.id, `Parse input to JSON failed: ${input}. Error: ${error}`, false);
            }
        }
        if (tool.guard) {
            const guardResult = tool.guard(input, context.loopConfig.mode);
            if (guardResult.result === 'denied') {
                await HookManager.emitVisitor('toolGuardDenied', context, {toolUseDef, reason: guardResult.reason});
                return this.toolResult(toolUseDef.id, `Tool run is not allowed: ${toolUseDef.name}. ${guardResult.reason}.`, false);
            } else if (guardResult.result === 'ask') {
                try {
                    const choice = await context.actions.agentHandler.onInteractionEvent(
                        { ...guardResult.question, clientId: context.clientId }
                    );
                    if (!guardResult.checkAnswer(choice)) {
                        return this.toolResult(toolUseDef.id, `Execution of tool ${tool.tool.name} is rejected by user.`, false);
                    }
                } catch (error) {
                    return this.toolResult(toolUseDef.id, `Error, wait for user response failed: ${error}`, false);
                }
            }
        }
        try {
            const output = await tool.invoke(input, context);
            const truncated = this.truncateLargeOutput(toolUseDef.id, output, context.sessionDir);
            return this.toolResult(toolUseDef.id, truncated, true);
        } catch (error) {
            return this.toolResult(toolUseDef.id, `Error: ${error}`, false);
        }
    }

    private static toolResult(toolUseId: string, content: string, success: boolean): ToolUseServiceResult {
        return ({
            result: {id: toolUseId, content},
            success
        });
    }

    private static truncateLargeOutput(toolUseId: string, output: string, sessionDir: string): string {
        if (output.length <= TRUNCATE_THRESHOLD) {
            return output;
        }
        const fileName = FileUtils.wrapTimestamp(`${toolUseId}.txt`);
        const fullPath = `${sessionDir}/${TOOL_RESULT_DIR}/${fileName}`;
        FileUtils.writeFile(fullPath, output);
        output = output.slice(0, PREVIEW_CHAR_LENGTH);
        return `<persisted-output>
Full output saved to: ${fullPath}
Preview:
${output}
</persisted-output>`;
    }
}
