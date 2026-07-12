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
    isToolInteractionPauseReason,
    ExternalStopReason,
    AgentRuntime,
    BREAK_POINTS,
    InterruptReason,
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
import { PersistHistoryService } from '../services/persist-history-service';

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
        const sessionDir = this.getSessionDir();
        PersistHistoryService.ensureSessionFilesExist({
            sessionDir,
            sessionId: this.sessionId,
            parentSessionId: this.parentSessionId,
            agentId: this.agentId,
            projectId: this.projectId,
            loopId: this.getId(),
            isSubLoop: this.isSubLoop(),
            llmProtocol: this.getLLMProtocol()
        });
        return PersistHistoryService.loadHistory(sessionDir);
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

    protected override async _resume(
        options: AgentInvokeOptions & {runtime: AgentRuntime}
    ): Promise<AgentInvokeResponse> {
        const state: LoopState<I> = {
            messages: this.history,
            oneLoopContext: this.initContext(options)
        };
        state.oneLoopContext.runtime.interruptReason = undefined;
        return this._invokeLoopAndReturn(state);
    }

    protected async _invoke(input: string, options: AgentInvokeOptions): Promise<AgentInvokeResponse> {
        this.addStringMessage(input);
        this.externalStopReason = undefined;
        const state: LoopState<I> = {
            messages: this.history,
            oneLoopContext: this.initContext(options)
        };
        await HookManager.emitVisitor('preLoopStart', state.oneLoopContext);
        return this._invokeLoopAndReturn(state);
    }

    private async _invokeLoopAndReturn(state: LoopState<I>): Promise<AgentInvokeResponse> {
        let finalText = '';
        try {
            PersistHistoryService.updateSessionRuntime(state.oneLoopContext.sessionDir, {status: 'running'});
            finalText = await this.agentLoop(state);
            return {text: finalText, runtime: state.oneLoopContext.runtime};
        } catch (error) {
            const msg = `Error in loop, ${error instanceof Error ? error.message : 'Unknown error.'}`;
            state.oneLoopContext.runtime.transitionReason = 'error';
            state.oneLoopContext.logger.error(error, msg);
            finalText = msg;
            return {text: msg, runtime: state.oneLoopContext.runtime};
        } finally {
            try {
                // clear to remove breakpoint guard
                state.oneLoopContext.runtime.breakPoint.break = undefined;
                await HookManager.emitVisitor('postLoopEnd', state.oneLoopContext);
            } finally {
                PersistHistoryService.saveHistory(this.history, state.oneLoopContext, {finalText}, true);
                this.historyPersistIndex = state.oneLoopContext.runtime.historyPersistIndex;
            }
        }
    }

    private initContext(options: AgentInvokeOptions): OneLoopContext {
        return {
            loopId: this.getId(),
            isSubLoop: this.isSubLoop(),
            agentId: this.agentId,
            projectId: this.projectId,
            loopConfig: this.agentConfig,
            browserId: options.browserId,
            sessionDir: this.isSubLoop() ? `${FileUtils.getTmpDir()}/${SUB_LOOP_DIR}/${this.sessionId}` : this.getSessionDir(),
            system: '',
            logger: getLoopLogger(this.parentSessionId, this.sessionId, crypto.randomUUID().toString()),
            actions: {
                newSubLoop: this.createSubLoop.bind(this),
                addFootPrint: (footPrint: FootPrint) => this.footPrints.push(footPrint),
                compactIfNeeded: (context: OneLoopContext) => this.compactIfNeeded(context),
                agentHandler: this.agentHandler,
                addStringMessage: this.addStringMessage.bind(this),
            },
            runtime: options.runtime ?? {
                ...this.emptyRuntime(),
                historyPersistIndex: this.historyPersistIndex,
            }
        }
    }

    private async agentLoop(state: LoopState<I>): Promise<string> {
        while (true) {
            const runtime = state.oneLoopContext.runtime;
            if (runtime.breakPoint.point <= BREAK_POINTS.loopStart) {
                runtime.breakPoint.point = BREAK_POINTS.none;
                if (runtime.turnCount >= this.turnLimit) {
                    runtime.transitionReason = 'endLoop';
                    const finalText = i18nInstance.t('agent.maxTurnReached', {
                        finalText: this.extractFinalText(state.messages)
                    });
                    this.agentHandler.onStreamText({
                        browserId: state.oneLoopContext.browserId,
                        text: finalText
                    });
                    return finalText;
                }
                state.oneLoopContext.system = PromptService.provideSystemPrompt(
                    this.agentConfig, AgentIdentityManager.getAgent(this.agentId),
                    this.projectId, this.isSubLoop()
                );
            }
            const goAround = await this.runOneTurn(state);
            if (!goAround) {
                let finalText = this.extractFinalText(state.messages);
                if (runtime.transitionReason === 'error') {
                    this.agentHandler.onStreamText({
                        browserId: state.oneLoopContext.browserId,
                        text: finalText || i18nInstance.t('common.unexpected')
                    });
                } else if (isExternalStopReason(runtime.interruptReason)) {
                    finalText = this.wrapExternalFlagMessage(finalText, runtime.interruptReason);
                }
                return finalText;
            }
        }
    }

    private wrapExternalFlagMessage(text: string, flag: InterruptReason) {
        return `${text || ''}\n\n${i18nInstance.t(`agent.externalStop.${flag}`)}`;
    }

    private async compactIfNeeded(context: OneLoopContext): Promise<void> {
        const compactor = MessageCompactor.getCompactor(this.getLLMProtocol());
        compactor.compactOldResults(this.history, context);
        await compactor.compactFullHistory(context, this.footPrints, this.llm, this.history);
    }

    private async runOneTurn(state: LoopState<I>): Promise<boolean> {
        const runtime = state.oneLoopContext.runtime;
        let response: O | undefined = undefined;
        if (!runtime.breakPoint.break && runtime.breakPoint.point <= BREAK_POINTS.callLLM) {
            runtime.breakPoint.point = BREAK_POINTS.none;
            await HookManager.emitVisitor('preTurnStart', state.oneLoopContext);
            response = await this.llm.invoke(
                state.oneLoopContext.loopConfig.mode,
                state.oneLoopContext.system,
                state.messages,
                (text: string) => this.agentHandler.onStreamText({
                    browserId: state.oneLoopContext.browserId,
                    text
                }),
                state.oneLoopContext.logger
            );

            this.addTokenUsage(state.oneLoopContext, response);

            state.oneLoopContext.runtime.turnCount++;
            state.oneLoopContext.runtime.transitionReason = response.transitionReason;
        }

        switch (runtime.transitionReason) {
            case 'toolUse':
                if (!runtime.breakPoint.break && runtime.breakPoint.point <= BREAK_POINTS.toolUse) {
                    const toolUseDefs = runtime.breakPoint.point === BREAK_POINTS.toolUse ?
                        runtime.breakPoint.input as ToolUseDef[] : this.extractToolUseFromResponse(response!);
                    runtime.breakPoint.point = BREAK_POINTS.none;

                    const results = await this.runTools(toolUseDefs, state.oneLoopContext);
                    this.convertToolResultMessages(results).forEach(msg => state.messages.push(msg));
                    if (isToolStopReason(runtime.interruptReason)) {
                        const stopText = i18nInstance.t(`agent.tools.project.stop.${runtime.interruptReason as string}`);
                        this.addStringMessage(stopText || `Loop paused: ${runtime.interruptReason}`, false);
                    } else if (isToolInteractionPauseReason(runtime.interruptReason)) {
                        await HookManager.emitVisitor('toolInteractionPause', state.oneLoopContext, runtime.interruptReason);
                    }
                }
                break;
            case 'inputMaxTokens':
                await this.compactIfNeeded(state.oneLoopContext);
                break;
            case 'maxTokens':
                runtime.recoveryState.maxTokenRetries++;
                if (runtime.recoveryState.maxTokenRetries >= this.maxTokenRetries) {
                    runtime.transitionReason = 'error';
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
        if (!runtime.breakPoint.break && runtime.breakPoint.point <= BREAK_POINTS.postTurn) {
            runtime.breakPoint.point = BREAK_POINTS.none;
            try {
                if (runtime.transitionReason === 'error') {
                    await HookManager.emitVisitor('turnError', state.oneLoopContext);
                } else if (this.externalStopReason) {
                    runtime.interruptReason = this.externalStopReason;
                }
                if (isExternalStopReason(runtime.interruptReason)) {
                    await HookManager.emitVisitor('turnExternalStop', state.oneLoopContext, runtime.interruptReason);
                }
                await HookManager.emitVisitor('postTurnEnd', state.oneLoopContext);
            } finally {
                PersistHistoryService.saveHistory(this.history, state.oneLoopContext);
            }
        }
        return !runtime.breakPoint.break && runtime.transitionReason !== 'endLoop'
            && runtime.transitionReason !== 'error'
            && !runtime.interruptReason;
    }

    protected abstract addTokenUsage(context: OneLoopContext, response: O): void;

    private async runTools(toolUseDefs: ToolUseDef[], context: OneLoopContext): Promise<ToolUseResult[]> {
        const results: ToolUseResult[] = [];
        for (let i = 0; i < toolUseDefs.length; i++) {
            const toolUseDef = toolUseDefs[i]!;
            if (isToolStopReason(context.runtime.interruptReason)) {
                const stopText = i18nInstance.t(`agent.tools.project.stop.${context.runtime.interruptReason}`);
                const toolResult = {
                    result: {
                        id: toolUseDef.id,
                        content: `Tool call execution skipped because loop paused for user review: ${stopText}`
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
                if (isToolInteractionPauseReason(context.runtime.interruptReason)) {
                    context.runtime.breakPoint = {
                        point: BREAK_POINTS.toolUse,
                        input: toolUseDefs.slice(i),
                        break: true
                    }
                    return results;
                }
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
