import process from 'node:process';
import { ContentBlock, MessageParam } from '@anthropic-ai/sdk/resources/messages/messages.js';
import { ToolUseBlock } from '@anthropic-ai/sdk/resources';
import { extractText, formatLLMText } from '../utils/utils.js';
import { LLMModel } from '../llm/init-llmgw.js';
import { bashTool, ToolCallback, ToolDesc, ToolUseResult } from '../tools/tools.js';

type LoopState = {  
    messages: MessageParam[];
    turnCount: number;
    transition_reason?: string
}

const SYSTEM = `You are a coding agent on ${process.platform.includes('win32') ? 'Windows' : 'Linux'} at ${process.cwd()}. "
"Use bash to inspect and change the workspace. Act first, then report clearly."`

export class LoopAgent {
    private llmModel: LLMModel;
    private toolMap: Map<string, ToolCallback> = new Map();
    private history: MessageParam[] = [];
    private builtInTools: ToolDesc[] = [bashTool];
    private onStreamEvent: (text: string) => void = () => {};

    constructor(system: string = SYSTEM, tools: ToolDesc[] = []) {
        tools = tools.concat(this.builtInTools);
        this.registerTools(tools);
        this.llmModel = new LLMModel(system, tools?.map(t => t.tool));
    }

    setStreamHandler(onStreamEvent: (text: string) => void) {
        this.onStreamEvent = onStreamEvent;
    }

    private registerTools(tools?: ToolDesc[]): void {
        if (!tools) return;
        for (const tool of tools) {
            this.toolMap.set(tool.tool.name, tool.invoke);
        }
    }

    private async executeToolCalls(contents: ContentBlock[]): Promise<ToolUseResult[] | null> {
        const results: ToolUseResult[] = [];
        for (const block of contents) {
            if (!this.isToolUse(block)) {
                continue
            }
            const command = (block.input as any)["command"];
            const tool = this.toolMap.get(block.name)!;
            const output = await tool(command);
            results.push({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": output,
            })
        }   
        return results.length > 0 ? results : null;
    }

    private isToolUse(content: ContentBlock): content is ToolUseBlock {
        return content.type === "tool_use"
    }

    private async runOneTurn(state: LoopState): Promise<boolean> {
        const response = await this.llmModel.invoke(state.messages, this.onStreamEvent);
        state.messages.push({"role": "assistant", "content": response.content});

        if (response.stop_reason != "tool_use") {
            state.transition_reason = '';
            return false
        }

        const results = await this.executeToolCalls(response.content)
        if (!results) {
            state.transition_reason = '';
            return false
        }

        state.messages.push({"role": "user", "content": results})
        state.turnCount += 1
        state.transition_reason = "tool_result"
        return true;
    }

    private async agentLoop(state: LoopState): Promise<string> {
        while (true) {
            const goAound = await this.runOneTurn(state);
            if (!goAound) {
                const finalText = extractText(state.messages[state.messages.length - 1]!.content)
                if (finalText) {
                    return formatLLMText(finalText);
                }
            }
        }
    }

    async invoke(input: string): Promise<string> {
        this.history.push({"role": "user", "content": input})
        const state: LoopState = {
            messages: this.history,
            turnCount: 0,
        }
        return await this.agentLoop(state);
    }
}

