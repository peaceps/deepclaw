import crypto from 'node:crypto';
import type { Logger } from 'pino';
import { FlushAgent, AgentStreamHandler } from '@core';
import { ToolUseContext, ToolUseResult } from '../../definitions/tool-definitions.js';
import { TodoManager } from '../services/todo-manager.js';
import { FootPrint, LoopState} from '../../definitions/definitions.js';
import { ToolUseService, ToolUseDef } from '../services/tool-use-service.js';
import { PromptService } from '../services/prompt-service.js';
import { ToolsManager } from '../services/tools-manager.js';
import { LLMModel, LLMConstructor } from '../../llm/llmgw.js';
import { MessagesCompactor } from '../compactor/messages-compactor.js';
import { loadAgentConfig, DeepclawConfig, getLogger } from '@utils';
import { HookManager } from '../services/hook-manager.js';

export abstract class LoopAgent<I, O, LLM extends LLMModel<I, O, unknown, unknown>> extends FlushAgent {
    protected llm: LLM;
    private turnLimit: number = loadAgentConfig<DeepclawConfig['agent']['loopTurnLimit']>('loopTurnLimit');
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
            oneLoopContext: {
                toDoManager: new TodoManager(),
                toDoUpdated: false,
                turnCount: 0,
                footPrints: this.footPrints,
                logger: getLogger(this.parentSessionId, this.sessionId, crypto.randomUUID().toString())
            },
        };
        try {
            await HookManager.emitVisitor('preLoopStart', state.oneLoopContext);
            const result = await this.agentLoop(state);
            return result;
        } catch (error) {
            const msg = `Error in loop, ${error instanceof Error ? error.message : 'Unknown error.'}`;
            state.oneLoopContext.logger.error(error, msg);
            return msg;
        } finally {
            await HookManager.emitVisitor('postLoopEnd', state.oneLoopContext);
        }
    }

    private async agentLoop(state: LoopState<I>): Promise<string> {
        while (true) {
            if (state.oneLoopContext.turnCount >= this.turnLimit) {
                const finalText = `Reached maximum turn count. Ending session.\n${this.extractFinalText(state)}`;
                this.streamHandler.onText(finalText);
                return finalText;
            }
            await this.compact(state.oneLoopContext.logger);
            const goAround = await this.runOneTurn(state);
            if (!goAround) {
                return this.extractFinalText(state);
            }
        }
    }

    private async runOneTurn(state: LoopState<I>): Promise<boolean> {
        await HookManager.emitVisitor('preTurnStart', state.oneLoopContext);
        const response = await this.llm.invoke(
            state.messages,
            this.streamHandler,
            state.oneLoopContext.logger
        );

        let quit: boolean = this.quitLoop(response);
        const toolUseDefs = this.extractToolUseFromResponse(response);
        const goAround = !quit && toolUseDefs.length > 0;
        if (!goAround) {
            state.oneLoopContext.transitionReason = 'noToolUse';
        } else {
            const results = await this.runTools(toolUseDefs, {
                loop: this,
                oneLoopContext: state.oneLoopContext,
            });
            this.convertToolResultMessages(results).forEach(msg => state.messages.push(msg));
            this.postAllToolUse(state);
        }
        await HookManager.emitVisitor('postTurnEnd', state.oneLoopContext);
        return goAround;
    }

    private async runTools(toolUseDefs: ToolUseDef[], context: ToolUseContext): Promise<ToolUseResult[]> {
        const results: ToolUseResult[] = [];
        for (const toolUseDef of toolUseDefs) {
            await HookManager.emitVisitor('preEachToolUse', context.oneLoopContext, toolUseDef);
            const result = await HookManager.emitInterceptor('preEachToolUse', context.oneLoopContext, toolUseDef);
            if (result && result.result === 'stop') {
                results.push({
                    id: toolUseDef.id,
                    content: result.reason || 'Tool use rejected by hook.',
                });
            } else {
                const toolResult = await this.toolUseService.executeToolCall(toolUseDef, context);
                if (toolResult.effect.outputToUser) {
                    this.streamHandler.onText(toolResult.result.content);
                }
                results.push(toolResult.result);
                await HookManager.emitVisitor('postEachToolUse', context.oneLoopContext);
            }
        }
        return results;
    }

    private postAllToolUse(state: LoopState<I>): void {
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
        context.transitionReason = 'toolResult';
    }

    protected addStringMessage(message: string): void {
        this.history.push(this.llm.newInputMessage(message));
    }

    public async compact(logger: Logger): Promise<void> {
        await this.messagesCompactor.compact(this.history, logger);
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
