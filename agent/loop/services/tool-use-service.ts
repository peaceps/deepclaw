import { ContentBlock, ToolUnion, ToolUseBlock } from "@anthropic-ai/sdk/resources";
import { ToolDesc, ToolUseContext, TOOL_RESULT, TOOL_USE, ToolUseResult } from "../tools/tool-definitions";
import { LoopContent } from "../definitions";

export type ToolUseServiceResult = {
    result: ToolUseResult;
    effect: {
        outputToUser: boolean;
    }
}

export class ToolUseService {
    private toolMap: Map<string, ToolDesc> = new Map();

    constructor(tools: ToolDesc[]) {
        for (const tool of tools) {
            this.toolMap.set(tool.tool.name, tool);
        }
    }

    public getAvailableTools(): ToolUnion[] {
        return Array.from(this.toolMap.values()).map(t => t.tool)
    }

    public async executeToolCalls(block: ToolUseBlock, context: ToolUseContext): Promise<ToolUseServiceResult> {
        const tool = this.toolMap.get(block.name);
        if (!tool) {
            return this.toolResult(block.id, `Unknown tool: ${block.name}`);
        }
        if (tool.guard) {
            const {allowed, feedback} = tool.guard(block.input);
            if (!allowed) {
                return this.toolResult(block.id, `Tool run is not allowed: ${block.name}. ${feedback}.`);
            }
        }
        try {
            const output = await tool.invoke(block.input, context);
            return this.toolResult(block.id, output, !!tool.outputToUser);
        } catch (error) {
            return this.toolResult(block.id, `Error: ${error}`);
        }
    }

    private toolResult(toolUseId: string, content: string, outputToUser: boolean = false): ToolUseServiceResult {
        return ({
            result: {
                type: TOOL_RESULT,
                tool_use_id: toolUseId,
                content,
            },
            effect: {
                outputToUser,
            },
        });
    }

    public postToolUse(results: LoopContent[], context: ToolUseContext): void {
        if (!context.oneLoopContext.toDoUpdated) {
            const reminder = context.oneLoopContext.toDoManager.noteRoundWithoutUpdate();
            if (reminder) {
                results.unshift({type: 'text', text: reminder});
            }
        } else {
            context.oneLoopContext.toDoUpdated = false;
        }
    }

    public isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
        return block.type === TOOL_USE
    }
}