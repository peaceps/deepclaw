import crypto from 'node:crypto';
import { i18nInstance } from '@deepclaw/i18n';
import { 
    type AgentInfoEvent,
    type AgentInteractionEvent,
    FlushAgent,
    type AgentHandler,
    type AgentToolResultEvent,
    AgentInvokeOptions,
    type TransitionReason,
    isExternalStopReason,
    isToolStopReason,
    AgentInvokeResponse,
    isPauseInLoopReason,
    ExternalStopReason
} from '@deepclaw/core';
import { ToolUseResult, ToolUseDef } from '../../definitions/tool-definitions';
import {
    FootPrint, LLMProtocol, LoopState, OneLoopContext,
} from '../../definitions/definitions';
import { ToolUseService } from '../services/tool-use-service';
import { PromptService } from '../services/prompt-service';
import { LLMModel, LLMConstructor } from '../../llm/llmgw';
import { FileUtils, getLoopLogger } from '@deepclaw/node-utils';
import { HookManager } from '../services/hook-manager';
import { AgentConfig, loadAgentConfig } from '@deepclaw/config';
import { detectAgentProtocolFromUrl } from '../../loop-protocol-detector';
import {
    AGENT_SESSION_DIR, AGENTS_DIR, PROJECT_DIR, SUB_LOOP_DIR
} from '../../paths';
import { MessageCompactor } from '../compactor/messages-compactor';
import { AgentIdentityManager } from '../services/agent-identity-manager';
import { MetaDataConfig, PersistHistoryService } from '../services/persist-history-service';

export abstract class LoopAgent<I, O extends { transitionReason: TransitionReason },
    LLM extends LLMModel<I, O, unknown, unknown>> extends FlushAgent {
    protected llm: LLM;
    private turnLimit: number = 100;
    private maxTokenRetries: number = 3;
    protected parentSessionId: string;
    private historyPersistIndex: number = 0;
    private sessionId: string;
    protected history: I[] = [];
    private footPrints: FootPrint[] = [];
    private agentConfig: AgentConfig;
    private externalStopReason: ExternalStopReason | undefined;

    constructor(
        agentId: string,
        handler: AgentHandler,
        projectId: string = '',
        history: I[] = [],
        parentSessionId: string = '',
    ) {
        super(agentId, projectId, handler);
        this.agentConfig = loadAgentConfig(agentId);
        this.parentSessionId = parentSessionId;
        this.sessionId = this.initializeSessionId(history);
        this.history = this.loadPersistedHistory(history);
        this.historyPersistIndex = this.history.length;
        this.llm = new (this.getLLMConstructor())(
            this.isSubLoop(),
            this.agentConfig.llm,
        ) as LLM;
    }

    protected abstract getLLMProtocol(): LLMProtocol;

    private initializeSessionId(history: I[]): string {
        if (this.isSubLoop() || this.projectId || history.length > 0) {
            return crypto.randomUUID();
        }
        return PersistHistoryService.loadLatestAgentSessionId(this.agentId, this.getLLMProtocol()) || crypto.randomUUID();
    }

    private loadPersistedHistory(history: I[]): I[] {
        if (this.isSubLoop() || history.length > 0) {
            return history;
        }
        return PersistHistoryService.loadHistory(this.getSessionDir());
    }

    protected getSessionDir() {
        if (!!this.projectId) {
            return `${PROJECT_DIR}/${this.projectId}`;
        } else {
            return `${AGENTS_DIR}/${this.agentId}/${AGENT_SESSION_DIR}/${this.sessionId}`;
        }
    }

    public updateConfig(config: AgentConfig): void {
        const oldLLMConfig = this.agentConfig.llm;
        const newLLMConfig = config.llm;
        this.agentConfig = config;
        let newClient = null;
        if (oldLLMConfig.baseURL !== newLLMConfig.baseURL || oldLLMConfig.apiKey !== newLLMConfig.apiKey) {
            let protocolChanged = false;
            if (oldLLMConfig.baseURL !== newLLMConfig.baseURL) {
                const oldProtocol = detectAgentProtocolFromUrl(oldLLMConfig.baseURL);
                const newProtocol = detectAgentProtocolFromUrl(newLLMConfig.baseURL);
                protocolChanged = oldProtocol !== newProtocol;
            }
            if (!protocolChanged) {
                newClient = {
                    baseURL: newLLMConfig.baseURL,
                    apiKey: newLLMConfig.apiKey,
                }
            }
        }
        const runtimeConfigs = {model: newLLMConfig.model};

        this.llm.updateGWConfig(newClient, runtimeConfigs);
    }

    protected isSubLoop(): boolean {
        return this.parentSessionId !== '';
    }

    protected abstract getLLMConstructor(): LLMConstructor<I, O, unknown, unknown>;

    protected async _invoke(input: string, options: AgentInvokeOptions): Promise<AgentInvokeResponse> {
        this.addStringMessage(input);
        this.externalStopReason = undefined;
        const state: LoopState<I> = {
            messages: this.history,
            oneLoopContext: {
                loopId: this.getId(),
                isSubLoop: this.isSubLoop(),
                agentId: this.agentId,
                projectId: this.projectId,
                clientId: options.clientId,
                sessionDir: this.isSubLoop() ? `${FileUtils.getTmpDir()}/${SUB_LOOP_DIR}/${this.sessionId}` : this.getSessionDir(),
                turnCount: 0,
                system: '',
                logger: getLoopLogger(this.parentSessionId, this.sessionId, crypto.randomUUID().toString()),
                recoveryState: {
                    maxTokenRetries: 0,
                    refusalState: '',
                },
                loopConfig: this.agentConfig,
                historyPersistIndex: this.historyPersistIndex,
                actions: {
                    newSubLoop: this.createSubLoop.bind(this),
                    addFootPrint: (footPrint: FootPrint) => this.footPrints.push(footPrint),
                    compactIfNeeded: () => this.compactIfNeeded(state.oneLoopContext),
                    agentHandler: this.agentHandler,
                    addStringMessage: this.addStringMessage.bind(this),
                },
                usage: {
                    cachedInputTokens: 0,
                    cacheCreationInputTokens: 0,
                    noCachedInputTokens: 0,
                    outputTokens: 0
                }
            },
        };
        let finalText = '';
        try {
            await HookManager.emitVisitor('preLoopStart', state.oneLoopContext);
            this.persistHistory(state.oneLoopContext, {
                status: 'running',
            });
            finalText = await this.agentLoop(state);
            return {text: finalText, state: state.oneLoopContext.transitionReason || 'endLoop'};
        } catch (error) {
            const msg = `Error in loop, ${error instanceof Error ? error.message : 'Unknown error.'}`;
            state.oneLoopContext.transitionReason = 'error';
            state.oneLoopContext.logger.error(error, msg);
            finalText = msg;
            return {text: msg, state: 'error'};
        } finally {
            try {
                await HookManager.emitVisitor('postLoopEnd', state.oneLoopContext);
            } finally {
                this.persistHistory(state.oneLoopContext, {
                    finalText,
                    forceMessagesSnapshot: true
                });
                this.historyPersistIndex = state.oneLoopContext.historyPersistIndex;
            }
        }
    }

    private async agentLoop(state: LoopState<I>): Promise<string> {
        while (true) {
            if (state.oneLoopContext.turnCount >= this.turnLimit) {
                state.oneLoopContext.transitionReason = 'endLoop';
                const finalText = i18nInstance.t('agent.maxTurnReached', {
                    finalText: this.extractFinalText(state.messages)
                });
                this.agentHandler.onStreamText({
                    clientId: state.oneLoopContext.clientId,
                    text: finalText
                });
                return finalText;
            }
            state.oneLoopContext.system = PromptService.provideSystemPrompt(
                this.agentConfig, AgentIdentityManager.getAgent(this.agentId),
                this.projectId, this.isSubLoop()
            );
            const goAround = await this.runOneTurn(state);
            if (!goAround) {
                let finalText = this.extractFinalText(state.messages);
                if (finalText && state.oneLoopContext.transitionReason === 'error') {
                    this.agentHandler.onStreamText({
                        clientId: state.oneLoopContext.clientId,
                        text: finalText
                    });
                }
                if (isExternalStopReason(state.oneLoopContext.transitionReason)) {
                    finalText = this.wrapExternalFlagMessage(finalText, state.oneLoopContext.transitionReason);
                }
                return finalText;
            }
        }
    }

    private wrapExternalFlagMessage(text: string, flag: string) {
        return `${text || ''}\n\n${i18nInstance.t(`agent.externalStop.${flag}`)}`;
    }

    private async compactIfNeeded(context: OneLoopContext): Promise<void> {
        const compactor = MessageCompactor.getCompactor(this.getLLMProtocol());
        compactor.compactOldResults(this.history, context);
        await compactor.compactFullHistory(context, this.footPrints, this.llm, this.history);
    }

    private async runOneTurn(state: LoopState<I>): Promise<boolean> {
        await HookManager.emitVisitor('preTurnStart', state.oneLoopContext);
        const response = await this.llm.invoke(
            state.oneLoopContext.loopConfig.mode,
            state.oneLoopContext.system,
            state.messages,
            (text: string) => this.agentHandler.onStreamText({
                clientId: state.oneLoopContext.clientId,
                text
            }),
            state.oneLoopContext.logger
        );

        this.addTokenUsage(state.oneLoopContext, response);

        state.oneLoopContext.turnCount++;
        state.oneLoopContext.transitionReason = response.transitionReason;

        switch (state.oneLoopContext.transitionReason) {
            case 'toolUse':
                const toolUseDefs = this.extractToolUseFromResponse(response);
                const results = await this.runTools(toolUseDefs, state.oneLoopContext);
                this.convertToolResultMessages(results).forEach(msg => state.messages.push(msg));
                if (isToolStopReason(state.oneLoopContext.transitionReason)) {
                    this.addStringMessage(state.oneLoopContext.toolStopText || `Loop paused: ${state.oneLoopContext.transitionReason}`, false);
                }
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
        try {
            if (state.oneLoopContext.transitionReason === 'error') {
                await HookManager.emitVisitor('turnError', state.oneLoopContext);
            } else if (this.externalStopReason) {
                state.oneLoopContext.transitionReason = this.externalStopReason;
            }
            if (isExternalStopReason(state.oneLoopContext.transitionReason)) {
                await HookManager.emitVisitor('turnExternalStop', state.oneLoopContext, state.oneLoopContext.transitionReason);
            }
            if (isPauseInLoopReason(state.oneLoopContext.transitionReason)) {
                await HookManager.emitVisitor('turnPauseInLoop', state.oneLoopContext, state.oneLoopContext.transitionReason);
            }
            await HookManager.emitVisitor('postTurnEnd', state.oneLoopContext);
        } finally {
            this.persistHistory(state.oneLoopContext, {});
        }
        return state.oneLoopContext.transitionReason !== 'endLoop'
            && state.oneLoopContext.transitionReason !== 'error'
            && !isExternalStopReason(state.oneLoopContext.transitionReason)
            && !isPauseInLoopReason(state.oneLoopContext.transitionReason)
            && !isToolStopReason(state.oneLoopContext.transitionReason);
    }

    private persistHistory(context: OneLoopContext, config: Partial<MetaDataConfig>): void {
        PersistHistoryService.saveHistory(this.history, context, {
            ...config,
            llmProtocol: this.getLLMProtocol(),
            sessionId: this.sessionId,
            parentSessionId: this.parentSessionId,
        });
    }

    protected abstract addTokenUsage(context: OneLoopContext, response: O): void;

    private async runTools(toolUseDefs: ToolUseDef[], context: OneLoopContext): Promise<ToolUseResult[]> {
        const results: ToolUseResult[] = [];
        for (const toolUseDef of toolUseDefs) {
            if (isToolStopReason(context.transitionReason)) {
                const toolResult = {
                    result: {
                        id: toolUseDef.id,
                        content: `Tool call execution skipped because loop paused for user review: ${context.toolStopText}`
                    }
                };
                results.push(toolResult.result);
                continue;
            } else if (isPauseInLoopReason(context.transitionReason)) {
                const toolResult = {
                    result: {
                        id: toolUseDef.id,
                        content: `Tool call execution skipped because loop paused due to ${context.transitionReason}`
                    }
                };
                results.push(toolResult.result);
                continue;
            }
            await HookManager.emitVisitor('preEachToolUse', context, toolUseDef);
            const result = await HookManager.emitInterceptor('preEachToolUse', context, toolUseDef);
            if (result && result.result === 'stop') {
                results.push({
                    id: toolUseDef.id,
                    content: result.stopReason || 'Tool use rejected by hook.',
                });
            } else {
                const toolResult = await ToolUseService.executeToolCall(toolUseDef, context);
                results.push(toolResult.result);
                await HookManager.emitVisitor('postEachToolUse', context, {toolUseDef, result: toolResult});
            }
        }
        return results;
    }

    protected addStringMessage(message: string, user: boolean = true): void {
        this.history.push(this.llm.newInputMessage(message, user));
    }
        
    protected extractFinalText(messages: I[]): string {
        return messages.length === 0 ? '' :
            this.llm.getTextFromInputMessage(messages[messages.length - 1]!);
    }

    public setExternalStopReason(reason: ExternalStopReason | undefined): void {
        this.externalStopReason = reason;
    }

    protected abstract extractToolUseFromResponse(result: O): ToolUseDef[];

    protected abstract convertToolResultMessages(toolResults: ToolUseResult[]): I[];

    public createSubLoop(fork?: boolean): LoopAgent<I, O, LLM> {
        if (this.isSubLoop()) {
            throw new Error('Sub-loop cannot create a sub-loop');
        }
        return this.newSubLoop(this.agentId, this.projectId, {
            onStreamText: () => {},
            onToolText: (e: AgentToolResultEvent) => this.agentHandler.onToolText(e),
            onInteractionEvent: async (event: AgentInteractionEvent) => this.agentHandler.onInteractionEvent(event),
            onInfoEvent: (event: AgentInfoEvent) => this.agentHandler.onInfoEvent(event),
        }, fork ? this.history : [], this.sessionId);
    }

    protected abstract newSubLoop(
        agentId: string,
        projectId: string,
        subLoopAgentHandler: AgentHandler,
        history: I[],
        parentSessionId: string,
    ): LoopAgent<I, O, LLM>;
}
