import crypto from 'node:crypto';
import { i18nInstance } from '@deepclaw/i18n';
import { AgentInteractionEvent, FlushAgent, type AgentHandler } from '@deepclaw/core';
import { ToolUseResult } from '../../definitions/tool-definitions.js';
import { FootPrint, LoopState, OneLoopContext, TransitionReason} from '../../definitions/definitions.js';
import { ToolUseService, ToolUseDef } from '../services/tool-use-service.js';
import { PromptService } from '../services/prompt-service.js';
import { ToolsManager } from '../services/tools-manager.js';
import { LLMModel, LLMConstructor } from '../../llm/llmgw.js';
import { MessagesCompactor } from '../compactor/messages-compactor.js';
import { getLogger } from '@deepclaw/utils';
import { HookManager } from '../services/hook-manager.js';

export abstract class LoopAgent<I, O extends { transitionReason: TransitionReason }, LLM extends LLMModel<I, O, unknown, unknown>> extends FlushAgent {
    protected llm: LLM;
    private turnLimit: number = 100;
    private maxTokenRetries: number = 3;
    protected parentSessionId: string;
    private sessionId: string;
    protected history: I[] = [];
    protected toolUseService: ToolUseService;
    private messagesCompactor: MessagesCompactor<I, O, unknown, LLM>;
    private footPrints: FootPrint[] = [];

    constructor(
        handler: AgentHandler,
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
            this.agentHandler
        );
        this.llm = new (this.getLLMConstructor())(
            tools.map(tool => tool.tool)
        ) as LLM;
        this.messagesCompactor = this.createMessagesCompactor(this.parentSessionId, this.sessionId, this.footPrints);
    }

    protected isSubLoop(): boolean {
        return this.parentSessionId !== '';
    }

    protected abstract getLLMConstructor(): LLMConstructor<I, O, unknown, unknown>;

    protected abstract createMessagesCompactor(parentSessionId: string, sessionId: string, footPrints: FootPrint[]): MessagesCompactor<I, O, unknown, LLM>;

    protected async _invoke(input: string): Promise<string> {
        this.addStringMessage(input);
        const state: LoopState<I> = {
            messages: this.history,
            oneLoopContext: {
                turnCount: 0,
                system: '',
                logger: getLogger(this.parentSessionId, this.sessionId, crypto.randomUUID().toString()),
                recoveryState: {
                    maxTokenRetries: 0,
                    refusalState: '',
                },
                actions: {
                    newSubLoop: this.createSubLoop.bind(this),
                    addFootPrint: (footPrint: FootPrint) => this.footPrints.push(footPrint),
                    compactIfNeeded: () => this.compactIfNeeded(state.oneLoopContext),
                    agentHandler: this.agentHandler,
                }
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
                const finalText = i18nInstance.t('agent.maxTurnReached', {finalText: this.extractFinalText(state)});
                this.agentHandler.onStreamText(finalText);
                return finalText;
            }
            state.oneLoopContext.system = PromptService.provideSystemPrompt(this.isSubLoop());
            const goAround = await this.runOneTurn(state);
            if (!goAround) {
                const finalText = this.extractFinalText(state);
                if (finalText && state.oneLoopContext.transitionReason === 'error') {
                    this.agentHandler.onStreamText(finalText);
                }
                return finalText;
            }
        }
    }

    private async compactIfNeeded(context: OneLoopContext): Promise<void> {
        this.messagesCompactor.compactOldResults(this.history);
        await this.messagesCompactor.compactFullHistory(context.system, this.history, context.logger);
    }

    private async runOneTurn(state: LoopState<I>): Promise<boolean> {
        await HookManager.emitVisitor('preTurnStart', state.oneLoopContext);
        const response = await this.llm.invoke(
            state.oneLoopContext.system,
            state.messages,
            (text: string) => this.agentHandler.onStreamText(text),
            state.oneLoopContext.logger
        );

        state.oneLoopContext.turnCount++;
        state.oneLoopContext.transitionReason = response.transitionReason;

        switch (state.oneLoopContext.transitionReason) {
            case 'toolUse':
                const toolUseDefs = this.extractToolUseFromResponse(response);
                const results = await this.runTools(toolUseDefs, state.oneLoopContext);
                this.convertToolResultMessages(results).forEach(msg => state.messages.push(msg));
                break;
            case 'inputMaxTokens':
                await this.compactIfNeeded(state.oneLoopContext);
                break;
            case 'maxTokens':
                state.oneLoopContext.recoveryState.maxTokenRetries++;
                if (state.oneLoopContext.recoveryState.maxTokenRetries >= this.maxTokenRetries) {
                    state.oneLoopContext.transitionReason = 'error';
                    break;
                }
                // TODO: Handle max tokens/输入测token管理
                this.addStringMessage(`Output limit hit. Continue directly from where you stopped -- 
                    no recap, no repetition. Pick up mid-sentence if needed.`);
                break;
            case 'refused':
                // TODO: Handle refused 输入侧意图识别分类/模式匹配 -> 询问用户
                break;
        }
        if (state.oneLoopContext.transitionReason === 'error') {
            await HookManager.emitVisitor('turnError', state.oneLoopContext);
        }
        await HookManager.emitVisitor('postTurnEnd', state.oneLoopContext);
        return state.oneLoopContext.transitionReason !== 'endLoop' && state.oneLoopContext.transitionReason !== 'error';
    }

    private async runTools(toolUseDefs: ToolUseDef[], context: OneLoopContext): Promise<ToolUseResult[]> {
        const results: ToolUseResult[] = [];
        for (const toolUseDef of toolUseDefs) {
            await HookManager.emitVisitor('preEachToolUse', context, toolUseDef);
            const result = await HookManager.emitInterceptor('preEachToolUse', context, toolUseDef);
            if (result && result.result === 'stop') {
                results.push({
                    id: toolUseDef.id,
                    content: result.stopReason || 'Tool use rejected by hook.',
                });
            } else {
                const toolResult = await this.toolUseService.executeToolCall(toolUseDef, context);
                if (toolResult.effect.outputToUser) {
                    this.agentHandler.onToolText(toolResult.result.content);
                }
                results.push(toolResult.result);
                await HookManager.emitVisitor('postEachToolUse', context);
            }
        }
        return results;
    }

    protected addStringMessage(message: string): void {
        this.history.push(this.llm.newInputMessage(message));
    }
        
    protected extractFinalText(state: LoopState<I>): string {
        return state.messages.length === 0 ? '' :
            this.llm.getTextFromInputMessage(state.messages[state.messages.length - 1]!);
    }

    protected abstract extractToolUseFromResponse(result: O): ToolUseDef[];

    protected abstract convertToolResultMessages(toolResults: ToolUseResult[]): I[];

    public createSubLoop(fork?: boolean): LoopAgent<I, O, LLM> {
        if (this.isSubLoop()) {
            throw new Error('Sub-loop cannot create a sub-loop');
        }
        return this.newSubLoop({
            onStreamText: () => {},
            onToolText: (content: string) => this.agentHandler.onToolText(content),
            onInteractionEvent: async (event: AgentInteractionEvent) => this.agentHandler.onInteractionEvent(event),
        }, fork ? this.history : [], this.sessionId);
    }

    protected abstract newSubLoop(
        subLoopAgentHandler: AgentHandler,
        history: I[],
        parentSessionId: string,
    ): LoopAgent<I, O, LLM>;
}
