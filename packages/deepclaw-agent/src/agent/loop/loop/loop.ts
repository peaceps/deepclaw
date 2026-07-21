import { randomUUID } from 'crypto';
import { i18nInstance } from '@deepclaw/i18n';
import { 
    type AgentInfoEvent,
    type AgentInteractionEvent,
    FlushAgent,
    type AgentHandler,
    type AgentToolResultEvent,
    AgentInvokeOptions,
    type LLMTransitionReason,
    isExternalInterruptReason,
    isAgentStopReason,
    AgentInvokeResponse,
    isInternalInterruptReason,
    ExternalInterruptReason,
    AgentRuntime,
    BREAK_POINTS,
    AgentBreakReason,
    isStopTransitionReason,
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
import { SUB_LOOP_DIR } from '../../paths';
import { MessageCompactor } from '../compactor/messages-compactor';
import { AgentIdentityManager } from '../services/agent-identity-manager';
import { SessionService } from '../services/session-service';

export abstract class LoopAgent<I, O extends { transitionReason: LLMTransitionReason },
    LLM extends LLMModel<I, O, unknown, unknown>> extends FlushAgent {
    protected llm: LLM;
    private turnLimit: number = 100;
    private maxTokenRetries: number = 3;
    private historyPersistIndex: number = 0;
    private history: I[] = [];
    private outdated: boolean = false;
    private footPrints: FootPrint[] = [];
    private agentConfig: AgentConfig;
    private externalInterruptReason: ExternalInterruptReason | undefined;
    private subLoopId?: string;

    constructor(
        agentId: string,
        handler: AgentHandler,
        projectId: string = '',
        subLoopId?: string,
    ) {
        super(agentId, projectId, handler);
        this.subLoopId = subLoopId;
        this.agentConfig = loadAgentConfig(agentId);
        this.loadSessionData();
        this.llm = new (this.getLLMConstructor())(
            this.isSubLoop(),
            this.agentConfig.llm,
        ) as LLM;
    }

    protected abstract getLLMProtocol(): LLMProtocol;

    private loadSessionData(): void {
        const {history, outdated} = SessionService.loadSession<I>({
            sessionDir: this.getSessionDir(),
            agentId: this.agentId,
            projectId: this.projectId,
            loopId: this.getId(),
            isSubLoop: this.isSubLoop(),
            llmProtocol: this.getLLMProtocol()
        });
        this.history = history;
        this.outdated = outdated;
        this.historyPersistIndex = this.history.length;
    }

    protected getSessionDir(): string {
        return this.isSubLoop() ? `${FileUtils.getTmpDir()}/${SUB_LOOP_DIR}/${this.subLoopId}`
            : SessionService.getSessionDir(this.agentId, this.projectId);
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
            } else {
                this.outdated = true;
            }
        }
        const runtimeConfigs = {model: newLLMConfig.model};

        this.llm.updateGWConfig(newClient, runtimeConfigs);
    }

    protected isSubLoop(): boolean {
        return !!this.subLoopId;
    }

    public isOutdated(): boolean {
        return this.outdated;
    }

    protected abstract getLLMConstructor(): LLMConstructor<I, O, unknown, unknown>;

    protected override async _resume(
        options: AgentInvokeOptions & {runtime: AgentRuntime}
    ): Promise<AgentInvokeResponse> {
        const state: LoopState<I> = {
            messages: this.history,
            oneLoopContext: this.initContext(options)
        };
        return this._invokeLoopAndReturn(state);
    }

    protected async _invoke(input: string, options: AgentInvokeOptions): Promise<AgentInvokeResponse> {
        this.addStringMessage(input);
        this.externalInterruptReason = undefined;
        const state: LoopState<I> = {
            messages: this.history,
            oneLoopContext: this.initContext(options)
        };
        await HookManager.emitVisitor('preLoopStart', state.oneLoopContext);
        return this._invokeLoopAndReturn(state);
    }

    private async _invokeLoopAndReturn(state: LoopState<I>): Promise<AgentInvokeResponse> {
        const runtime = state.oneLoopContext.runtime;
        let finalText = '';
        try {
            SessionService.updateSessionRuntime(state.oneLoopContext, {status: 'running'});
            finalText = await this.agentLoop(state);
            return {text: finalText, runtime};
        } catch (error) {
            const msg = `Error in loop, ${error instanceof Error ? error.message : 'Unknown error.'}`;
            runtime.transitionReason = 'error';
            runtime.agentBreakReason = undefined;
            state.oneLoopContext.logger.error(error, msg);
            finalText = msg;
            return {text: msg, runtime};
        } finally {
            runtime.breakPoint.break = undefined;
            try {
                await HookManager.emitVisitor('postLoopEnd', state.oneLoopContext);
            } finally {
                SessionService.saveHistory(this.history, state.oneLoopContext, {
                    finalText, usage: runtime.usage
                }, true);
                this.historyPersistIndex = runtime.historyPersistIndex;
                if (isInternalInterruptReason(runtime.agentBreakReason)) {
                    runtime.usage.cachedInputTokens = 0;
                    runtime.usage.noCachedInputTokens = 0;
                    runtime.usage.outputTokens = 0;
                }
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
            sessionDir: this.getSessionDir(),
            system: {cacheable: '', dynamic: ''},
            logger: getLoopLogger(this.getId(), this.subLoopId),
            actions: {
                newSubLoop: this.createSubLoop.bind(this),
                addFootPrint: (footPrint: FootPrint) => this.footPrints.push(footPrint),
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
                    await HookManager.emitVisitor('turnError', state.oneLoopContext);
                    finalText = finalText || i18nInstance.t('common.unexpected');
                } else if (isAgentStopReason(runtime.agentBreakReason)) {
                    finalText = runtime.agentBreakDetail || this.wrapAgentBreakMessage(finalText, 'agentStop', runtime.agentBreakReason);
                } else if (isExternalInterruptReason(runtime.agentBreakReason)) {
                    await HookManager.emitVisitor('externalInterrupt', state.oneLoopContext, runtime.agentBreakReason);
                    finalText = runtime.agentBreakDetail || this.wrapAgentBreakMessage(finalText, 'externalInterrupt', runtime.agentBreakReason);
                } else if (isInternalInterruptReason(runtime.agentBreakReason)) {
                    await HookManager.emitVisitor('internalInterrupt', state.oneLoopContext, runtime.agentBreakReason);
                }
                return finalText;
            }
        }
    }

    private wrapAgentBreakMessage(text: string, type: string, flag: AgentBreakReason) {
        return `${text || ''}\n\n${i18nInstance.t(`agent.agentBreak.${type}.${flag}.user`)}`;
    }

    private async compactIfNeeded(context: OneLoopContext): Promise<void> {
        const compactor = MessageCompactor.getCompactor(this.getLLMProtocol());
        if (!this.outdated) {
            compactor.compactOldResults(this.history, context);
        }
        await compactor.compactFullHistory(
            this.outdated, context, this.footPrints, this.llm, this.history
        );
        if (this.outdated) {
            this.outdated = false;
        }
    }

    private async runOneTurn(state: LoopState<I>): Promise<boolean> {
        const runtime = state.oneLoopContext.runtime;
        let response: O | undefined = undefined;
        if (!runtime.breakPoint.break && runtime.breakPoint.point <= BREAK_POINTS.callLLM) {
            runtime.breakPoint.point = BREAK_POINTS.none;
            await HookManager.emitVisitor('preTurnStart', state.oneLoopContext);
            
            await this.compactIfNeeded(state.oneLoopContext);
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
                if (isStopTransitionReason(runtime.transitionReason) || isAgentStopReason(runtime.agentBreakReason)) {
                    this.externalInterruptReason = undefined;
                }
                if (this.externalInterruptReason) {
                    runtime.agentBreakReason = this.externalInterruptReason;
                    this.externalInterruptReason = undefined;
                }
            } finally {
                await HookManager.emitVisitor('postTurnEnd', state.oneLoopContext);
                SessionService.saveHistory(this.history, state.oneLoopContext);
            }
        }
        return !runtime.breakPoint.break && !isStopTransitionReason(runtime.transitionReason)
            && !runtime.agentBreakReason;
    }

    private addTokenUsage(context: OneLoopContext, response: O): void {
        const tokenUsage = this.llm.getTokenUsage(response);
        context.runtime.usage.cachedInputTokens += tokenUsage.cachedInputTokens;
        context.runtime.usage.noCachedInputTokens += tokenUsage.noCachedInputTokens;
        context.runtime.usage.outputTokens += tokenUsage.outputTokens;
    }

    private async runTools(toolUseDefs: ToolUseDef[], context: OneLoopContext): Promise<ToolUseResult[]> {
        const results: ToolUseResult[] = [];
        for (let i = 0; i < toolUseDefs.length; i++) {
            const toolUseDef = toolUseDefs[i]!;
            const breakReason = context.runtime.agentBreakReason;
            if (isAgentStopReason(breakReason) || isExternalInterruptReason(breakReason)) {
                const stopType = isAgentStopReason(breakReason) ? 'agentStop' : 'externalInterrupt';
                const stopText = i18nInstance.t(`agent.agentBreak.${stopType}.${breakReason}.llm`);
                const toolResult = {
                    result: {
                        id: toolUseDef.id,
                        content: `Tool call execution skipped because loop terminated due to: ${stopText}`
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
                if (isInternalInterruptReason(context.runtime.agentBreakReason)) {
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

    public setExternalInterruptReason(reason: ExternalInterruptReason): void {
        this.externalInterruptReason = reason;
    }

    protected abstract extractToolUseFromResponse(result: O): ToolUseDef[];

    protected abstract convertToolResultMessages(toolResults: ToolUseResult[]): I[];

    public createSubLoop(): LoopAgent<I, O, LLM> {
        if (this.isSubLoop()) {
            throw new Error('Sub-loop cannot create a sub-loop');
        }
        return this.newSubLoop(this.agentId, this.projectId, {
            onStreamText: () => {},
            onToolText: (e: AgentToolResultEvent) => this.agentHandler.onToolText(e),
            onInteractionEvent: async (event: AgentInteractionEvent) => this.agentHandler.onInteractionEvent(event),
            onInfoEvent: (event: AgentInfoEvent) => this.agentHandler.onInfoEvent(event),
        }, randomUUID());
    }

    protected abstract newSubLoop(
        agentId: string,
        projectId: string,
        subLoopAgentHandler: AgentHandler,
        subLoopId: string,
    ): LoopAgent<I, O, LLM>;
}
