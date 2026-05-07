import { extractText, formatLLMText } from '../utils/utils.js';
import { OpenAILLMModel } from '../llm/openai-llm.js';
import { ToolUseContext, ToolUseResult } from '../definitions/tool-definitions.js';
import { TodoManager } from './services/todo-manager.js';
import { FlushAgent } from '../flush-agent.js';
import { LoopMessageParam, LoopState} from '../definitions/definitions.js';
import { SkillsManager } from './services/skills-manager.js';
import { ToolUseService, ToolUseDef } from './services/tool-use-service.js';
import { PromptService, SystemPrompt } from './services/prompt-service.js';
import { ToolsManager } from './services/tools-manager.js';

type InvokableLLM<I, O> = {
    invoke(messages: LoopMessageParam<I>[], onStreamEvent: (text: string) => void): Promise<O>;
};

export abstract class LoopAgent<I, O, LLM extends InvokableLLM<I, O>> extends FlushAgent {
    private llmModel: LLM;
    private history: LoopMessageParam<I>[] = [];
    private turnLimit: number;
    protected toolUseService: ToolUseService;
    protected skillsManager: SkillsManager;
    protected promptService: PromptService;
    protected toolsManager: ToolsManager;

    constructor(onStreamEvent: (text: string) => void, history: LoopMessageParam<I>[] = [], system?: SystemPrompt, turnLimit: number = 10) {
        super(onStreamEvent);
        this.history = history;
        this.turnLimit = turnLimit;
        this.toolsManager = new ToolsManager();
        this.toolUseService = new ToolUseService(this.toolsManager.provideTools(this instanceof SubLoopAgent));
        this.skillsManager = new SkillsManager();
        this.promptService = new PromptService(this.skillsManager, system);
        this.llmModel = this.createLLMModel();
    }

    protected abstract createLLMModel(): LLM;

    protected abstract extractToolCalls(result: O): ToolUseDef[];

    private async executeToolCalls(toolUseDefs: ToolUseDef[], context: ToolUseContext): Promise<ToolUseResult[]> {
        const results: ToolUseResult[] = [];
        for (const toolUseDef of toolUseDefs) {
            const toolResult = await this.toolUseService.executeToolCall(toolUseDef, context);
            if (toolResult.effect.outputToUser) {
                this.onStreamEvent(toolResult.result.content);
            }
            results.push(toolResult.result);
        }
        this.toolUseService.postToolUse(results, context);
        return results;
    }

    private async runOneTurn(state: LoopState<I>): Promise<boolean> {
        const response = await this.llmModel.invoke(state.messages, this.onStreamEvent);
        state.messages.push(this.convertResponseToMessages(response));

        if (this.quitLoop(response)) {
            state.oneLoopContext.transitionReason = '';
            return false;
        }

        const results = await this.executeToolCalls(this.extractToolCalls(response), {
            history: state.messages,
            skillsManager: this.skillsManager,
            oneLoopContext: state.oneLoopContext,
        });
        if (!results.length) {
            state.oneLoopContext.transitionReason = '';
            return false;
        }

        this.convertToolResultMessages(results).forEach(msg => state.messages.push(msg));
        state.oneLoopContext.turnCount++;
        state.oneLoopContext.transitionReason = 'tool_result';
        return true;
    }

    protected abstract convertResponseToMessages(response: O): LoopMessageParam<I>;

    protected abstract convertToolResultMessages(toolResults: ToolUseResult[]): LoopMessageParam<I>[];

    private async agentLoop(state: LoopState<I>): Promise<string> {
        while (true) {
            const goAound = await this.runOneTurn(state);
            if (state.oneLoopContext.turnCount >= this.turnLimit) {
                return 'Reached maximum turn count. Ending session.\n' + state.messages[state.messages.length - 1];
            }
            if (!goAound) {
                const finalText = extractText(state.messages[state.messages.length - 1]!);
                if (finalText) {
                    return formatLLMText(finalText);
                }
                return '';
            }
        }
    }

    protected async _invoke(input: string): Promise<string> {
        this.history.push({role: 'user', content: input});
        const state: LoopState<I> = {
            messages: this.history,
            oneLoopContext: {toDoManager: new TodoManager(), toDoUpdated: false, turnCount: 0},
        };
        const res = await this.agentLoop(state);
        return res;
    }

    protected abstract quitLoop(result: O): boolean;
}

export class SubLoopAgent<I, O> extends LoopAgent<I, O, any> {
    protected override convertToolResultMessages(toolResults: ToolUseResult[]): LoopMessageParam<I>[] {
        throw new Error('Method not implemented.');
    }
    protected override convertResponseToMessages(response: O): LoopMessageParam<I> {
        throw new Error('Method not implemented.');
    }
    protected override extractToolCalls(result: O): ToolUseDef[] {
        throw new Error('Method not implemented.');
    }
    protected override quitLoop(result: O): boolean {
        throw new Error('Method not implemented.');
    }
    constructor(history: LoopMessageParam<I>[] = []) {
        super(() => {}, history);
    }

    protected override createLLMModel(): OpenAILLMModel {
        return new OpenAILLMModel('1');
    }
}
