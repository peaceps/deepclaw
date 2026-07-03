import crypto from 'node:crypto';
import os from 'os';
import { i18nInstance } from '@deepclaw/i18n';
import { 
    type AgentInfoEvent,
    type AgentInteractionEvent,
    FlushAgent,
    type AgentHandler,
    type AgentToolResultEvent,
    AgentInvokeOptions,
} from '@deepclaw/core';
import { ToolUseResult } from '../../definitions/tool-definitions';
import {
    FootPrint, LLMProtocol, LoopState, OneLoopContext, TransitionReason,
    isToolStopReason, LoopSessionStatus, SessionMetadata
} from '../../definitions/definitions';
import { ToolUseService, ToolUseDef } from '../services/tool-use-service';
import { PromptService } from '../services/prompt-service';
import { LLMModel, LLMConstructor } from '../../llm/llmgw';
import { FileUtils, getLoopLogger } from '@deepclaw/node-utils';
import { HookManager } from '../services/hook-manager';
import { AgentConfig, loadAgentConfig } from '@deepclaw/config';
import { detectAgentProtocolFromUrl } from '../../loop-protocol-detector';
import {
    AGENT_SESSION_DIR, AGENTS_DIR, MESSAGE_SNAPSHOT_FILE, PROJECT_DIR,
    SESSION_METADATA_FILE, SUB_LOOP_DIR
} from '../../paths';
import { MessageCompactor } from '../compactor/messages-compactor';
import { AgentIdentityManager } from '../services/agent-identity-manager';

const SESSION_TIMEOUT = 1000 * 60 * 60 * 24;

export abstract class LoopAgent<I, O extends { transitionReason: TransitionReason },
    LLM extends LLMModel<I, O, unknown, unknown>> extends FlushAgent {
    protected llm: LLM;
    private turnLimit: number = 100;
    private maxTokenRetries: number = 3;
    protected parentSessionId: string;
    private sessionId: string;
    protected history: I[] = [];
    private footPrints: FootPrint[] = [];
    private agentConfig: AgentConfig;

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
        return this.loadLatestSessionId() || crypto.randomUUID();
    }

    private loadLatestSessionId(): string {
        const sessionRoot = `${AGENTS_DIR}/${this.agentId}/${AGENT_SESSION_DIR}`;
        const sessionId = FileUtils.findLatest(sessionRoot, MESSAGE_SNAPSHOT_FILE);
        if (!sessionId) {
            return '';
        }
        try {
            const metaFile = FileUtils.readFile(`${sessionRoot}/${sessionId}/${SESSION_METADATA_FILE}`);
            const meta = JSON.parse(metaFile) as SessionMetadata;
            if (meta.llmProtocol !== this.getLLMProtocol()) {
                return '';
            }
            const status = meta.status;
            const date = new Date(meta.updatedAt);
            if (Number.isNaN(date.getTime())) {
                return '';
            }
            let timeout = SESSION_TIMEOUT;
            switch(status) {
                case 'running':
                    timeout = SESSION_TIMEOUT * 2;
                    break;
                case 'paused':
                    timeout = SESSION_TIMEOUT * 7;
                    break;
                case 'ended':
                case 'error':
                default:
                    timeout = 0;
                    break;
            }
            const diff = new Date().getTime() - date.getTime();
            if (diff > timeout) {
                return '';
            }
            return sessionId;
        } catch {}
        return '';
    }

    protected getSessionDir() {
        if (!!this.projectId) {
            return `${PROJECT_DIR}/${this.projectId}`;
        } else {
            return `${AGENTS_DIR}/${this.agentId}/${AGENT_SESSION_DIR}/${this.sessionId}`;
        }
    }

    private loadPersistedHistory(history: I[]): I[] {
        if (this.isSubLoop() || history.length > 0) {
            return history;
        }

        try {
            const content = FileUtils.readFile(`${this.getSessionDir()}/${MESSAGE_SNAPSHOT_FILE}`);
            const messages = JSON.parse(content);
            return Array.isArray(messages) ? messages as I[] : history;
        } catch {
            return history;
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

    protected async _invoke(input: string, options: AgentInvokeOptions): Promise<string> {
        this.addStringMessage(input);
        const state: LoopState<I> = {
            messages: this.history,
            oneLoopContext: {
                loopId: this.getId(),
                isSubLoop: this.isSubLoop(),
                agentId: this.agentId,
                projectId: this.projectId,
                clientId: options.clientId,
                sessionDir: this.isSubLoop() ? `${os.tmpdir()}/.deepclaw/${SUB_LOOP_DIR}/${this.sessionId}` : this.getSessionDir(),
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
        let finalText = '';
        try {
            await HookManager.emitVisitor('preLoopStart', state.oneLoopContext);
            this.persistLoopState(state.oneLoopContext, 'running', undefined, false);
            finalText = await this.agentLoop(state);
            return finalText;
        } catch (error) {
            const msg = `Error in loop, ${error instanceof Error ? error.message : 'Unknown error.'}`;
            state.oneLoopContext.transitionReason = 'error';
            state.oneLoopContext.logger.error(error, msg);
            finalText = msg;
            return msg;
        } finally {
            try {
                await HookManager.emitVisitor('postLoopEnd', state.oneLoopContext);
            } finally {
                this.persistLoopState(state.oneLoopContext, this.getInvokeEndSessionStatus(state.oneLoopContext),
                    finalText || undefined, state.oneLoopContext.turnCount === 0);
            }
        }
    }

    private async agentLoop(state: LoopState<I>): Promise<string> {
        while (true) {
            if (state.oneLoopContext.turnCount >= this.turnLimit) {
                state.oneLoopContext.transitionReason = 'endLoop';
                const finalText = i18nInstance.t('agent.maxTurnReached', {
                    finalText: this.extractFinalText(state)
                });
                this.agentHandler.onStreamText({text: finalText});
                return finalText;
            }
            state.oneLoopContext.system = PromptService.provideSystemPrompt(
                this.agentConfig, AgentIdentityManager.getAgent(this.agentId),
                this.projectId, this.isSubLoop()
            );
            const goAround = await this.runOneTurn(state);
            if (!goAround) {
                const finalText = this.extractFinalText(state);
                if (finalText && state.oneLoopContext.transitionReason === 'error') {
                    this.agentHandler.onStreamText({text: finalText});
                }
                return finalText;
            }
        }
    }

    private async compactIfNeeded(context: OneLoopContext): Promise<void> {
        const compactor = MessageCompactor.getCompactor(this.getLLMProtocol());
        compactor.compactOldResults(this.history);
        await compactor.compactFullHistory(context.sessionDir, this.footPrints,
            context.loopConfig.mode, this.llm, context.system, this.history, context.logger
        );
    }

    private async runOneTurn(state: LoopState<I>): Promise<boolean> {
        await HookManager.emitVisitor('preTurnStart', state.oneLoopContext);
        const response = await this.llm.invoke(
            state.oneLoopContext.loopConfig.mode,
            state.oneLoopContext.system,
            state.messages,
            (text: string) => this.agentHandler.onStreamText({
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
        if (state.oneLoopContext.transitionReason === 'error') {
            await HookManager.emitVisitor('turnError', state.oneLoopContext);
        }
        try {
            await HookManager.emitVisitor('postTurnEnd', state.oneLoopContext);
        } finally {
            this.persistLoopState(state.oneLoopContext, this.getLoopSessionStatus(state.oneLoopContext), undefined, false);
        }
        return state.oneLoopContext.transitionReason !== 'endLoop' && state.oneLoopContext.transitionReason !== 'error'
            && !isToolStopReason(state.oneLoopContext.transitionReason);
    }

    private getLoopSessionStatus(context: OneLoopContext): LoopSessionStatus {
        if (context.transitionReason === 'error') {
            return 'error';
        }
        if (isToolStopReason(context.transitionReason)) {
            return 'paused';
        }
        if (context.transitionReason === 'endLoop') {
            return 'ended';
        }
        return 'running';
    }

    private getInvokeEndSessionStatus(context: OneLoopContext): LoopSessionStatus {
        if (!context.transitionReason) {
            return 'ended';
        }
        return this.getLoopSessionStatus(context);
    }

    private persistLoopState(context: OneLoopContext, status: LoopSessionStatus, finalText?: string, forceMessagesSnapshot: boolean = false): void {
        // Sub-loop context is intentionally not durably persisted; only parent/main loop state is durable.
        if (context.isSubLoop) {
            return;
        }
        try {
            const now = new Date().toISOString();
            const messagesPath = `${context.sessionDir}/${MESSAGE_SNAPSHOT_FILE}`;
            if (forceMessagesSnapshot || context.turnCount > 0) {
                FileUtils.writeFile(messagesPath, JSON.stringify(this.history));
            }
            const metadata: SessionMetadata = {
                llmProtocol: this.getLLMProtocol(),
                agentId: this.agentId,
                projectId: this.projectId,
                sessionId: this.sessionId,
                parentSessionId: this.parentSessionId || undefined,
                loopId: context.loopId,
                isSubLoop: context.isSubLoop,
                status,
                transitionReason: context.transitionReason,
                turnCount: context.turnCount,
                messagesPath,
                finalText,
                updatedAt: now,
                endedAt: status === 'running' ? undefined : now,
            };
            FileUtils.writeFile(
                `${context.sessionDir}/${SESSION_METADATA_FILE}`, JSON.stringify(metadata, null, 2)
            );
        } catch (error) {
            context.logger.error(error, 'Persist loop state failed');
        }
    }

    private async runTools(toolUseDefs: ToolUseDef[], context: OneLoopContext): Promise<ToolUseResult[]> {
        const results: ToolUseResult[] = [];
        let toolStop = false;
        for (const toolUseDef of toolUseDefs) {
            if (toolStop) {
                const toolResult = {
                    result: {
                        id: toolUseDef.id,
                        content: `Tool call execution skipped because loop paused for user review: ${context.toolStopText}`
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
                if (!toolStop && isToolStopReason(context.transitionReason)) {
                    toolStop = true;
                }
                results.push(toolResult.result);
                await HookManager.emitVisitor('postEachToolUse', context);
            }
        }
        return results;
    }

    protected addStringMessage(message: string, user: boolean = true): void {
        this.history.push(this.llm.newInputMessage(message, user));
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
