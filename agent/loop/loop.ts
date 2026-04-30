import process from 'node:process';
import { ContentBlock, MessageParam, ContentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages.js';
import { ToolUseBlock } from '@anthropic-ai/sdk/resources';
import { extractText, formatLLMText } from '../utils/utils.js';
import { LLMModel } from '../llm/llmgw.js';
import { builtInTools } from './tools/index.js';
import { ToolDesc, ToolUseResult, TOOL_RESULT_TYPE } from './tools/tool-definitions.js';
import { TodoManager } from './todo-manager.js';
import { FlushAgent } from '../flush-agent.js';

type LoopMessageParam = {
    role: MessageParam['role'];
    content: LoopContent[] | string;
}

type LoopState = {
    messages: LoopMessageParam[];
    turnCount: number;
    transition_reason?: string
}

type LoopContent = ToolUseResult | ContentBlockParam;

const SYSTEM = `You are a assistant agent on ${process.platform.includes('win32') ? 'Windows' : 'Linux'} at "${process.cwd()}".
Use bash to inspect and change the workspace. Act first, then report clearly.

On each task begin, create a visible todo list with the todo tool before executing if the task should be done in multiple steps.
Use the todo tool for multi-step work.
Keep exactly one step inProgress when a task has multiple steps.
Refresh the plan as work advances. Prefer tools over prose.
When you are done, mark all the todo list as completed with the todo tool.`

export class LoopAgent extends FlushAgent {
    private llmModel: LLMModel;
    private toolMap: Map<string, ToolDesc> = new Map();
    private history: LoopMessageParam[] = [];

    constructor(onStreamEvent: (text: string) => void, system: string = SYSTEM, tools: ToolDesc[] = []) {
        super(onStreamEvent);
        tools = tools.concat(builtInTools);
        this.registerTools(tools);
        this.llmModel = new LLMModel(system, tools?.map(t => t.tool));
    }

    private registerTools(tools?: ToolDesc[]): void {
        if (!tools) return;
        for (const tool of tools) {
            this.toolMap.set(tool.tool.name, tool);
        }
    }

    private async executeToolCalls(contents: ContentBlock[]): Promise<LoopContent[] | null> {
        const results: LoopContent[] = [];
        let usedTodo = false;
        for (const block of contents) {
            if (!this.isToolUse(block)) {
                continue;
            }
            const tool = this.toolMap.get(block.name);
            if (!tool) {
                this.addToolResult(results, block.id, `Unknown tool: ${block.name}`);
                break;
            }
            if (tool.guard) {
                const {allowed, feedback} = tool.guard(block.input);
                if (!allowed) {
                    this.addToolResult(results, block.id, `Tool run is not allowed: ${block.name}. ${feedback}.`);
                    break;
                }
            }
            try {
                const output = await tool.invoke(block.input);
                this.addToolResult(results, block.id, output);
                if (tool.tool.name === 'todo') {
                    usedTodo = true;
                }
            } catch (error) {
                this.addToolResult(results, block.id, `Error: ${error}`);
                break;
            }
        }
        if (!usedTodo) {
            const reminder = TodoManager.getInstance().noteRoundWithoutUpdate();
            if (reminder) {
                results.unshift({type: 'text', text: reminder});
            }
        }
        return results.length > 0 ? results : null;
    }

    private addToolResult(results: LoopContent[], tool_use_id: string, content: string): void {
        results.push({
            type: TOOL_RESULT_TYPE,
            tool_use_id: tool_use_id,
            content: content,
        })
    }

    private isToolUse(content: ContentBlock): content is ToolUseBlock {
        return content.type === "tool_use"
    }

    private async runOneTurn(state: LoopState): Promise<boolean> {
        const response = await this.llmModel.invoke(state.messages as MessageParam[], this.onStreamEvent);
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

        state.messages.push({role: 'user', content: results})
        state.turnCount++;
        state.transition_reason = 'tool_result'
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

    protected async _invoke(input: string): Promise<string> {
        TodoManager.getInstance().reset(this.onStreamEvent);
        this.history.push({role: 'user', content: input})
        const state: LoopState = {
            messages: this.history,
            turnCount: 0,
        }
        const res = await this.agentLoop(state);
        return res;
    }
}

