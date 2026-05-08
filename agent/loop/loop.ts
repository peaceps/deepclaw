import { formatLLMText } from '../utils/utils.js';
import { ToolUseContext, ToolUseResult } from '../definitions/tool-definitions.js';
import { TodoManager } from './services/todo-manager.js';
import { FlushAgent } from '../flush-agent.js';
import { LoopMessageParam, LoopState} from '../definitions/definitions.js';
import { ToolUseService, ToolUseDef } from './services/tool-use-service.js';
import { PromptService, SystemPrompt } from './services/prompt-service.js';
import { ToolsManager } from './services/tools-manager.js';

type InvokableLLM<I, O> = {
    invoke(messages: LoopMessageParam<I>[], onStreamEvent: (text: string) => void): Promise<O>;
};

export abstract class LoopAgent<I extends object, O, LLM extends InvokableLLM<I, O>> extends FlushAgent {
    private llmModel: LLM;
    private turnLimit: number;
    protected isSubLoop: boolean;
    protected history: LoopMessageParam<I>[] = [];
    protected toolUseService: ToolUseService;
    protected promptService: PromptService;

    constructor(
        onStreamEvent: (text: string) => void,
        history: LoopMessageParam<I>[] = [],
        isSubLoop: boolean = false,
        system?: SystemPrompt,
        turnLimit: number = 20
    ) {
        super(onStreamEvent);
        this.history = history;
        this.turnLimit = turnLimit;
        this.isSubLoop = isSubLoop;
        this.toolUseService = new ToolUseService(ToolsManager.provideTools(isSubLoop));
        this.promptService = new PromptService(system);
        this.llmModel = this.createLLMModel();
    }

    protected abstract createLLMModel(): LLM;

    protected async _invoke(input: string): Promise<string> {
        this.history.push({role: 'user', content: input});
        const state: LoopState<I> = {
            messages: this.history,
            oneLoopContext: {toDoManager: new TodoManager(), toDoUpdated: false, turnCount: 0},
        };
        return await this.agentLoop(state);
    }

    private async agentLoop(state: LoopState<I>): Promise<string> {
        while (true) {
            const goAound = await this.runOneTurn(state);
            if (state.oneLoopContext.turnCount >= this.turnLimit) {
                const finalText = `Reached maximum turn count. Ending session.\n${this.extractFinalText(state)}`;
                this.onStreamEvent(finalText);
                return finalText;
            }
            if (!goAound) {
                return this.extractFinalText(state);
            }
        }
    }

    private async runOneTurn(state: LoopState<I>): Promise<boolean> {
        const response = await this.llmModel.invoke(state.messages, this.onStreamEvent);
        state.messages.push(this.convertResponseToMessages(response));

        if (this.quitLoop(response)) {
            state.oneLoopContext.transitionReason = 'no_tool_use';
            return false;
        }

        const results = await this.executeToolCalls(this.extractToolCalls(response), {
            loop: this,
            oneLoopContext: state.oneLoopContext,
        });
        if (!results.length) {
            state.oneLoopContext.transitionReason = 'no_tool_use';
            return false;
        }

        this.convertToolResultMessages(results).forEach(msg => state.messages.push(msg));

        this.postToolUse(state);
        return true;
    }

    private async executeToolCalls(toolUseDefs: ToolUseDef[], context: ToolUseContext): Promise<ToolUseResult[]> {
        const results: ToolUseResult[] = [];
        for (const toolUseDef of toolUseDefs) {
            const toolResult = await this.toolUseService.executeToolCall(toolUseDef, context);
            if (toolResult.effect.outputToUser) {
                this.onStreamEvent(toolResult.result.content);
            }
            results.push(toolResult.result);
        }
        return results;
    }

    private postToolUse(state: LoopState<I>): void {
        const context = state.oneLoopContext;
        if (!context.toDoUpdated) {
            const reminder = context.toDoManager.noteRoundWithoutUpdate();
            if (reminder) {
                state.messages.push({role: 'user', content: reminder});
            }
        } else {
            context.toDoUpdated = false;
        }
        context.turnCount++;
        context.transitionReason = 'tool_result';
    }

    protected abstract extractFinalText(state: LoopState<I>): string;

    protected abstract extractToolCalls(result: O): ToolUseDef[];

    protected abstract quitLoop(result: O): boolean;

    protected abstract convertResponseToMessages(response: O): LoopMessageParam<I>;

    protected abstract convertToolResultMessages(toolResults: ToolUseResult[]): LoopMessageParam<I>[];

    abstract createSubLoop(fork?: boolean): LoopAgent<I, O, LLM>;
}
