import { ContentBlock, MessageParam } from '@anthropic-ai/sdk/resources/messages/messages.js';
import { extractText, formatLLMText } from '../utils/utils.js';
import { LLMModel } from '../llm/llmgw.js';
import { ToolUseContext, ToolUseResult, TOOL_USE, TOOL_RESULT } from './tools/tool-definitions.js';
import { TodoManager } from './services/todo-manager.js';
import { FlushAgent } from '../flush-agent.js';
import { LoopMessageParam, LoopState, LoopContent} from './definitions.js';
import { SkillsManager } from './services/skills-manager.js';
import { ToolUseService } from './services/tool-use-service.js';
import { PromptService, SystemPrompt } from './services/prompt-service.js';
import { ToolsManager } from './services/tools-manager.js';

export class LoopAgent extends FlushAgent {
    private llmModel: LLMModel;
    private history: LoopMessageParam[] = [];
    private turnLimit: number;
    private toolUseService: ToolUseService;
    private skillsManager: SkillsManager;
    private promptService: PromptService;
    private toolsManager: ToolsManager;

    constructor(onStreamEvent: (text: string) => void, history: LoopMessageParam[] = [], system?: SystemPrompt, turnLimit: number = 10) {
        super(onStreamEvent);
        this.history = history;
        this.turnLimit = turnLimit;
        this.toolsManager = new ToolsManager();
        this.toolUseService = new ToolUseService(this.toolsManager.provideTools(this instanceof SubLoopAgent));
        this.skillsManager = new SkillsManager();
        this.promptService = new PromptService(this.skillsManager, system);
        this.llmModel = new LLMModel(
            this.promptService.provideSystemPrompt(this instanceof SubLoopAgent),
            this.toolUseService.getAvailableTools()
        );
    }

    private async executeToolCalls(contents: ContentBlock[], context: ToolUseContext): Promise<LoopContent[]> {
        const results: ToolUseResult[] = [];
        for (const block of contents) {
            if (!this.toolUseService.isToolUseBlock(block)) {
                continue;
            }
            const toolResult = await this.toolUseService.executeToolCalls(block, context);
            if (toolResult.effect.outputToUser) {
                this.onStreamEvent(toolResult.result.content);
            }
            results.push(toolResult.result);
        }
        this.toolUseService.postToolUse(results, context);
        return results;
    }

    private async runOneTurn(state: LoopState): Promise<boolean> {
        const response = await this.llmModel.invoke(state.messages as MessageParam[], this.onStreamEvent);
        state.messages.push({"role": "assistant", "content": response.content});

        if (response.stop_reason != TOOL_USE) {
            state.oneLoopContext.transitionReason = '';
            return false;
        }

        const results = await this.executeToolCalls(response.content, {
            history: state.messages,
            skillsManager: this.skillsManager,
            oneLoopContext: state.oneLoopContext,
        });
        if (!results.length) {
            state.oneLoopContext.transitionReason = '';
            return false;
        }

        state.messages.push({role: 'user', content: results});
        state.oneLoopContext.turnCount++;
        state.oneLoopContext.transitionReason = TOOL_RESULT;
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
    constructor(history: LoopMessageParam[] = []) {
        super(() => {}, history);
    }
}