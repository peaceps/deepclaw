import crypto from 'node:crypto';
import { FlushAgent } from '@core';
import { ToolUseContext, ToolUseResult } from '../../definitions/tool-definitions.js';
import { TodoManager } from '../services/todo-manager.js';
import { LoopState} from '../../definitions/definitions.js';
import { ToolUseService, ToolUseDef } from '../services/tool-use-service.js';
import { PromptService, SystemPrompt } from '../services/prompt-service.js';
import { ToolsManager } from '../services/tools-manager.js';
import { LLMModel } from '../../llm/llmgw.js';
import { MessagesCompactor } from '../compactor/messages-compactor.js';

export abstract class LoopAgent<I, O, LLM extends LLMModel<I, O, unknown, unknown>> extends FlushAgent {
    private llmModel: LLM;
    private turnLimit: number;
    private sessionId: string;
    protected isSubLoop: boolean;
    protected history: I[] = [];
    protected toolUseService: ToolUseService;
    protected promptService: PromptService;
    private messagesCompactor: MessagesCompactor<I, unknown>;

    constructor(
        onStreamEvent: (text: string) => void,
        history: I[] = [],
        isSubLoop: boolean = false,
        system?: SystemPrompt,
        turnLimit: number = 20
    ) {
        super(onStreamEvent);
        this.sessionId = crypto.randomUUID();
        this.history = history;
        this.turnLimit = turnLimit;
        this.isSubLoop = isSubLoop;
        this.toolUseService = new ToolUseService(ToolsManager.provideTools(isSubLoop), this.sessionId);
        this.promptService = new PromptService(system);
        this.llmModel = this.createLLMModel();
        this.messagesCompactor = this.createMessagesCompactor(this.sessionId);
    }

    protected abstract createLLMModel(): LLM;

    protected abstract createMessagesCompactor(sessionID: string): MessagesCompactor<I, unknown>;

    protected async _invoke(input: string): Promise<string> {
        this.addStringMessage(input);
        const state: LoopState<I> = {
            messages: this.history,
            oneLoopContext: {toDoManager: new TodoManager(), toDoUpdated: false, turnCount: 0},
        };
        return await this.agentLoop(state);
    }

    private async agentLoop(state: LoopState<I>): Promise<string> {
        while (true) {
            this.messagesCompactor.compactBeforeTurn(state.messages);
            const goAround = await this.runOneTurn(state);
            if (state.oneLoopContext.turnCount >= this.turnLimit) {
                const finalText = `Reached maximum turn count. Ending session.\n${this.extractFinalText(state)}`;
                this.onStreamEvent(finalText);
                return finalText;
            }
            if (!goAround) {
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

        const results = await this.runTools(this.extractToolUseFromResponse(response), {
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

    private async runTools(toolUseDefs: ToolUseDef[], context: ToolUseContext): Promise<ToolUseResult[]> {
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
                this.addStringMessage(reminder);
            }
        } else {
            context.toDoUpdated = false;
        }
        context.turnCount++;
        context.transitionReason = 'tool_result';
    }

    protected abstract addStringMessage(message: string): void

    protected abstract extractFinalText(state: LoopState<I>): string;

    protected abstract quitLoop(result: O): boolean;

    protected abstract extractToolUseFromResponse(result: O): ToolUseDef[];

    protected abstract convertResponseToMessages(response: O): I;

    protected abstract convertToolResultMessages(toolResults: ToolUseResult[]): I[];

    abstract createSubLoop(fork?: boolean): LoopAgent<I, O, LLM>;
}
