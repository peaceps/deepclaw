import crypto from 'node:crypto';
import { i18nInstance } from '@deepclaw/i18n';
import { 
    type AgentInfoEvent,
    type AgentInteractionEvent,
    FlushAgent,
    type AgentHandler,
    type AgentIdentity,
    AgentToolResultEvent,
} from '@deepclaw/core';
import { ToolUseResult } from '../../definitions/tool-definitions';
import { FootPrint, LoopState, OneLoopContext, TransitionReason} from '../../definitions/definitions';
import { ToolUseService, ToolUseDef } from '../services/tool-use-service';
import { PromptService } from '../services/prompt-service';
import { ToolsManager } from '../services/tools-manager';
import { LLMModel, LLMConstructor } from '../../llm/llmgw';
import { MessagesCompactor } from '../compactor/messages-compactor';
import { getLogger, Logger, getLoopLogger } from '@deepclaw/node-utils';
import { HookManager } from '../services/hook-manager';
import { DeepclawConfig, loadAgentConfig } from '@deepclaw/config';

export abstract class LoopAgent<I, O extends { transitionReason: TransitionReason }, LLM extends LLMModel<I, O, unknown, unknown>> extends FlushAgent {
    protected llm: LLM;
    private agentIdentity: AgentIdentity;
    private turnLimit: number = 100;
    private maxTokenRetries: number = 3;
    protected parentSessionId: string;
    private sessionId: string;
    protected history: I[] = [];
    protected toolUseService: ToolUseService;
    private messagesCompactor: MessagesCompactor<I, O, unknown, LLM>;
    private footPrints: FootPrint[] = [];
    private agentConfig: DeepclawConfig['agents'][0];
    private loopLogger: Logger;

    constructor(
        agentIdentity: AgentIdentity,
        handler: AgentHandler,
        history: I[] = [],
        parentSessionId: string = '',
    ) {
        super(handler);
        this.agentIdentity = agentIdentity;
        this.agentConfig = loadAgentConfig(agentIdentity.id);
        this.parentSessionId = parentSessionId;
        this.sessionId = crypto.randomUUID();
        this.history = history;
        this.loopLogger = getLogger(`loop.${this.agentIdentity.id}`);
        const tools = ToolsManager.provideTools(this.isSubLoop(), this.agentConfig.mode);
        this.toolUseService = new ToolUseService(
            tools,
            this.agentIdentity.id,
            this.parentSessionId,
            this.sessionId,
            this.agentHandler
        );
        this.llm = new (this.getLLMConstructor())(
            this.agentConfig.llm,
            tools.map(tool => tool.tool)
        ) as LLM;
        this.messagesCompactor = this.createMessagesCompactor(
            this.agentIdentity.id, this.parentSessionId, this.sessionId, this.footPrints
        );
    }

    public updateConfig(config: DeepclawConfig['agents'][0]): void {
        // Todo handle mode change caused tools change and standaloneTask change
        const oldConfig = this.agentConfig;
        this.agentConfig = config;

        if (this.agentConfig.llm.sdk !== oldConfig.llm.sdk) {
            // TODO loop type change
            this.loopLogger.info(`LLM sdk changed from ${oldConfig.llm.sdk} to ${this.agentConfig.llm.sdk}`);
            return;
        }

        if (this.agentConfig.mode !== oldConfig.mode
            || this.agentConfig.llm.baseURL !== oldConfig.llm.baseURL
            || this.agentConfig.llm.apiKey !== oldConfig.llm.apiKey
        ) {
            const tools = ToolsManager.provideTools(this.isSubLoop(), this.agentConfig.mode);
            if (this.agentConfig.mode !== oldConfig.mode) {
                this.toolUseService.updateTools(tools);
            }
            this.llm = new (this.getLLMConstructor())(
                this.agentConfig.llm,
                tools.map(tool => tool.tool)
            ) as LLM;
            this.messagesCompactor.updateLLM(this.llm);
        } else {
            this.llm.updateGWConfig({model: this.agentConfig.llm.model});
        }
    }

    protected isSubLoop(): boolean {
        return this.parentSessionId !== '';
    }

    protected abstract getLLMConstructor(): LLMConstructor<I, O, unknown, unknown>;

    protected abstract createMessagesCompactor(
        agentId: string, parentSessionId: string, sessionId: string, footPrints: FootPrint[]
    ): MessagesCompactor<I, O, unknown, LLM>;

    protected async _invoke(chatKey: string, input: string): Promise<string> {
        this.addStringMessage(input);
        const state: LoopState<I> = {
            messages: this.history,
            oneLoopContext: {
                chatKey,
                agentId: this.agentIdentity.id,
                turnCount: 0,
                system: '',
                logger: getLoopLogger(this.parentSessionId, this.sessionId, crypto.randomUUID().toString()),
                recoveryState: {
                    maxTokenRetries: 0,
                    refusalState: '',
                },
                loopConfig: this.agentConfig,
                actions: {
                    newSubLoop: this.createSubLoop.bind(this),
                    addFootPrint: (footPrint: FootPrint) => this.footPrints.push(footPrint),
                    compactIfNeeded: () => this.compactIfNeeded(state.oneLoopContext),
                    agentHandler: this.agentHandler,
                    addStringMessage: this.addStringMessage.bind(this),
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
                const finalText = i18nInstance.t('agent.maxTurnReached', {
                    finalText: this.extractFinalText(state)
                });
                this.agentHandler.onStreamText({chatKey: state.oneLoopContext.chatKey, text: finalText});
                return finalText;
            }
            state.oneLoopContext.system = PromptService.provideSystemPrompt(
                this.agentIdentity.id, this.isSubLoop(), this.agentConfig.mode
            );
            const goAround = await this.runOneTurn(state);
            if (!goAround) {
                const finalText = this.extractFinalText(state);
                if (finalText && state.oneLoopContext.transitionReason === 'error') {
                    this.agentHandler.onStreamText({chatKey: state.oneLoopContext.chatKey, text: finalText});
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
            (text: string) => this.agentHandler.onStreamText({
                chatKey: state.oneLoopContext.chatKey,
                text
            }),
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

    public getIdentity(): AgentIdentity {
        return this.agentIdentity;
    }

    public createSubLoop(fork?: boolean): LoopAgent<I, O, LLM> {
        if (this.isSubLoop()) {
            throw new Error('Sub-loop cannot create a sub-loop');
        }
        return this.newSubLoop(this.createSubLoopIdentity(), {
            onStreamText: () => {},
            onToolText: (e: AgentToolResultEvent) => this.agentHandler.onToolText(e),
            onInteractionEvent: async (event: AgentInteractionEvent) => this.agentHandler.onInteractionEvent(event),
            onInfoEvent: (event: AgentInfoEvent) => this.agentHandler.onInfoEvent(event),
        }, fork ? this.history : [], this.sessionId);
    }

    private createSubLoopIdentity(): AgentIdentity {
        return {
            id: this.agentIdentity.id,
            name: `${this.agentIdentity.name}-subloop`,
            avatar: '',
            role: 'temp loop',
            fired: false,
            description: 'You are a subloop',
            personalities: [],
            emotion: false,
            expertises: []
        };
    }

    protected abstract newSubLoop(
        agentIdentity: AgentIdentity,
        subLoopAgentHandler: AgentHandler,
        history: I[],
        parentSessionId: string,
    ): LoopAgent<I, O, LLM>;
}
