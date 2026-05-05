import process from 'node:process';
import { ContentBlock, MessageParam } from '@anthropic-ai/sdk/resources/messages/messages.js';
import { ToolUseBlock } from '@anthropic-ai/sdk/resources';
import { extractText, formatLLMText } from '../utils/utils.js';
import { LLMModel } from '../llm/llmgw.js';
import { builtInTools, subLoopBuiltInTools } from './tools/index.js';
import { ToolDesc, TOOL_RESULT_TYPE } from './tools/tool-definitions.js';
import { TodoManager } from './services/todo-manager.js';
import { FlushAgent } from '../flush-agent.js';
import { LoopMessageParam, LoopState, OneLoopContext, LoopContent} from './definitions.js';

const SYSTEM = `You are a assistant agent on ${process.platform.includes('win32') ? 'Windows' : 'Linux'} at "${process.cwd()}".
Use bash to inspect and change the workspace. Act first, then report clearly.

On each task begin, create a visible todo list with the todo tool before executing if the task should be done in multiple steps.
Use the todo tool for multi-step work.
Keep exactly one step inProgress when a task has multiple steps.
Refresh the plan as work advances. Prefer tools over prose.
When you are done, mark all the todo list as completed with the todo tool.`;

const SUB_LOOP_SYSTEM = `You are a assistant agent on ${process.platform.includes('win32') ? 'Windows' : 'Linux'} at "${process.cwd()}".
Complete the given task, then summarize your findings.`;

export class LoopAgent extends FlushAgent {
    private llmModel: LLMModel;
    private toolMap: Map<string, ToolDesc> = new Map();
    private history: LoopMessageParam[] = [];
    private turnLimit: number;

    constructor(onStreamEvent: (text: string) => void, history: LoopMessageParam[] = [], system: string = SYSTEM, turnLimit: number = 10) {
        super(onStreamEvent);
        this.history = history;
        this.turnLimit = turnLimit;
        this.registerTools();
        this.llmModel = new LLMModel(system, this.getTools().map(t => t.tool));
    }

    private registerTools(): void {
        for (const tool of this.getTools()) {
            this.toolMap.set(tool.tool.name, tool);
        }
    }

    protected getTools(): ToolDesc[] {
        return builtInTools;
    }

    private async executeToolCalls(contents: ContentBlock[], context: OneLoopContext): Promise<LoopContent[]> {
        const results: LoopContent[] = [];
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
                const output = await tool.invoke(block.input, context);
                if (tool.outputToUser) {
                    this.onStreamEvent(output);
                }
                this.addToolResult(results, block.id, output);
            } catch (error) {
                this.addToolResult(results, block.id, `Error: ${error}`);
                break;
            }
        }
        this.postToolUse(results, context);
        return results;
    }

    private addToolResult(results: LoopContent[], toolUseId: string, content: string): void {
        results.push({
            type: TOOL_RESULT_TYPE,
            tool_use_id: toolUseId,
            content: content,
        });
    }

    private postToolUse(results: LoopContent[], context: OneLoopContext): void {
        if (!context.toDoUpdated) {
            const reminder = context.toDoManager.noteRoundWithoutUpdate();
            if (reminder) {
                results.unshift({type: 'text', text: reminder});
            }
        } else {
            context.toDoUpdated = false;
        }
    }

    private isToolUse(content: ContentBlock): content is ToolUseBlock {
        return content.type === "tool_use";
    }

    private async runOneTurn(state: LoopState): Promise<boolean> {
        const response = await this.llmModel.invoke(state.messages as MessageParam[], this.onStreamEvent);
        state.messages.push({"role": "assistant", "content": response.content});

        if (response.stop_reason != "tool_use") {
            state.oneLoopContext.transitionReason = '';
            return false;
        }

        const results = await this.executeToolCalls(response.content, state.oneLoopContext);
        if (!results.length) {
            state.oneLoopContext.transitionReason = '';
            return false;
        }

        state.messages.push({role: 'user', content: results});
        state.oneLoopContext.turnCount++;
        state.oneLoopContext.transitionReason = 'tool_result';
        return true;
    }

    private async agentLoop(state: LoopState): Promise<string> {
        while (true) {
            const goAound = await this.runOneTurn(state);
            if (state.oneLoopContext.turnCount >= this.turnLimit) {
                return 'Reached maximum turn count. Ending session.\n' + state.messages[state.messages.length - 1]!.content;
            }
            if (!goAound) {
                const finalText = extractText(state.messages[state.messages.length - 1]!.content);
                if (finalText) {
                    return formatLLMText(finalText);
                }
            }
        }
    }

    protected async _invoke(input: string): Promise<string> {
        this.history.push({role: 'user', content: input});
        const state: LoopState = {
            messages: this.history,
            oneLoopContext: {toDoManager: new TodoManager(), toDoUpdated: false, turnCount: 0},
        };
        const res = await this.agentLoop(state);
        return res;
    }
}

export class SubLoopAgent extends LoopAgent {

    constructor(history: LoopMessageParam[] = [], system: string = SUB_LOOP_SYSTEM) {
        super(() => {}, history, system);
    }

    protected override getTools(): ToolDesc[] {
        return subLoopBuiltInTools;
    }
}