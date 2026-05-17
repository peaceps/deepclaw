import crypto from 'node:crypto';
import { FlushAgent, AgentStreamHandler } from '@core';
import { ToolUseContext, ToolUseResult } from '../../definitions/tool-definitions.js';
import { TodoManager } from '../services/todo-manager.js';
import { FootPrint, LoopState} from '../../definitions/definitions.js';
import { ToolUseService, ToolUseDef } from '../services/tool-use-service.js';
import { PromptService } from '../services/prompt-service.js';
import { ToolsManager } from '../services/tools-manager.js';
import { LLMModel, LLMConstructor } from '../../llm/llmgw.js';
import { MessagesCompactor } from '../compactor/messages-compactor.js';

export abstract class LoopAgent<I, O, LLM extends LLMModel<I, O, unknown, unknown>> extends FlushAgent {
    protected llm: LLM;
    private turnLimit: number = 100;
    protected parentSessionId: string;
    private sessionId: string;
    protected history: I[] = [];
    protected toolUseService: ToolUseService;
    private messagesCompactor: MessagesCompactor<I, O, unknown, LLM>;
    private footPrints: FootPrint[] = [];

    constructor(
        handler: AgentStreamHandler,
        history: I[] = [],
        parentSessionId: string = '',
    ) {
        super(handler);
        this.parentSessionId = parentSessionId;
        this.sessionId = crypto.randomUUID();
        this.history = history;
        const tools = ToolsManager.provideTools(this.isSubLoop());
        this.toolUseService = new ToolUseService(
            tools,
            this.parentSessionId,
            this.sessionId,
            this.streamHandler
        );
        this.llm = new (this.getLLMConstructor())(
            PromptService.provideSystemPrompt(this.isSubLoop()),
            tools.map(tool => tool.tool)
        ) as LLM;
        this.messagesCompactor = this.createMessagesCompactor(this.parentSessionId, this.sessionId, this.footPrints);
    }

    protected isSubLoop(): boolean {
        return this.parentSessionId !== '';
    }
    
    public addFootPrint(footPrint: FootPrint): void {
        this.footPrints.push(footPrint);
    }

    protected abstract getLLMConstructor(): LLMConstructor<I, O, unknown, unknown>;

    protected abstract createMessagesCompactor(parentSessionId: string, sessionId: string, footPrints: FootPrint[]): MessagesCompactor<I, O, unknown, LLM>;

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
            await this.compact();
            const goAround = await this.runOneTurn(state);
            if (state.oneLoopContext.turnCount >= this.turnLimit) {
                const finalText = `Reached maximum turn count. Ending session.\n${this.extractFinalText(state)}`;
                this.streamHandler.onText(finalText);
                return finalText;
            }
            if (!goAround) {
                return this.extractFinalText(state);
            }
        }
    }

    private async runOneTurn(state: LoopState<I>): Promise<boolean> {
        const response = await this.llm.invoke(state.messages, this.streamHandler);

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
                this.streamHandler.onText(toolResult.result.content);
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

    protected addStringMessage(message: string): void {
        this.history.push(this.llm.newInputMessage(message));
    }

    public async compact(): Promise<void> {
        await this.messagesCompactor.compact(this.history);
    }
        
    protected extractFinalText(state: LoopState<I>): string {
        return state.messages.length === 0 ? '' :
            this.llm.getTextFromInputMessage(state.messages[state.messages.length - 1]!);
    }

    protected abstract quitLoop(result: O): boolean;

    protected abstract extractToolUseFromResponse(result: O): ToolUseDef[];

    protected abstract convertToolResultMessages(toolResults: ToolUseResult[]): I[];

    public createSubLoop(fork?: boolean): LoopAgent<I, O, LLM> {
        if (this.isSubLoop()) {
            throw new Error('Sub-loop cannot create a sub-loop');
        }
        return this.newSubLoop(this.sessionId, fork);
    }

    protected abstract newSubLoop(parentSessionId: string, fork?: boolean): LoopAgent<I, O, LLM>;
}
