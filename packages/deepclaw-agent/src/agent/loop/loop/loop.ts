import { randomUUID } from 'crypto';
import { i18nInstance } from '@deepclaw/i18n';
import {
    type AgentInfoEvent,
    type AgentInteractionEvent,
    FlushAgent,
    type AgentHandler,
    AgentInvokeOptions,
    type LLMTransitionReason,
    isExternalInterruptReason,
    isAgentStopReason,
    AgentInvokeResponse,
    ExternalInterruptReason,
    AgentBreakReason,
    isStopTransitionReason,
    FlushAgentRole,
    addTokenUsage,
    isImageRef,
    type ImageContent,
    type SealedAgentHandler,
} from '@deepclaw/core';
import { ToolUseResult, ToolUseDef } from '../../definitions/tool-definitions';
import {
    AssignedTask, FootPrint, IMAGE_FOOT_PRINT, LLMProtocol, LoopKind, LoopState, OneLoopContext,
    PermissionWhiteList, SpawnedLoop,
} from '../../definitions/definitions';
import { ToolUseService } from '../services/tool-use-service';
import { PromptService } from '../services/prompt-service';
import { LLMModel, LLMConstructor } from '../../llm/llmgw';
import { getLoopLogger } from '@deepclaw/node-utils';
import { HookManager } from '../services/hook-manager';
import { AgentConfig, loadAgentConfig } from '@deepclaw/config';
import { detectAgentProtocolFromUrl } from '../../loop-protocol-detector';
import { MessageCompactor } from '../compactor/messages-compactor';
import { AgentIdentityManager } from '../services/agent-identity-manager';
import { SessionService } from '../services/session-service';

type ToolRunResult = {
    toolUseDef: ToolUseDef;
    result: ToolUseResult;
}

export abstract class LoopAgent<I, O extends { transitionReason: LLMTransitionReason },
    LLM extends LLMModel<I, O, unknown, unknown>> extends FlushAgent {
    protected llm: LLM;
    private turnLimit: number = 100;
    private maxTokenRetries: number = 3;
    private historyPersistIndex: number = 0;
    private sessionDir: string;
    private history: I[] = [];
    private outdated: boolean = false;
    private footPrints: FootPrint[] = [];
    private agentConfig: AgentConfig;
    private externalInterruptReason: ExternalInterruptReason | undefined;
    /**
     * The way the run in progress asks the user, when whoever started it brought one of its own. A
     * run from a chat is answered in that chat, and what a loop it spawned has to ask belongs to the
     * same conversation: the handler the loop was built with knows nothing of it.
     */
    private runInteraction?: SealedAgentHandler['onInteractionEvent'];
    /**
     * What this loop was spawned as, unset for the main loop of a session. Taken in through the
     * constructor because the session a loop reads and writes is picked from it before anything
     * else happens: a loop that learns what it is later has already read the wrong history.
     */
    private spawned?: SpawnedLoop;
    /**
     * What the user allowed for good, which outlives the turn it was allowed in: a runtime is built
     * anew for every message, and a permission kept there would be asked for again with the next
     * one. A spawned loop works with the list of the loop that spawned it. It goes down with this
     * loop, so a loop the gateway had to build again is a loop that asks once more.
     */
    private readonly permissionWhiteList: PermissionWhiteList;

    constructor(
        role: FlushAgentRole,
        agentId: string,
        projectId: string,
        handler: AgentHandler,
        spawned?: SpawnedLoop,
    ) {
        super(role, agentId, projectId, handler);
        this.spawned = spawned;
        this.permissionWhiteList = spawned?.permissionWhiteList ?? new Set();
        this.agentConfig = loadAgentConfig(this.agentId);
        if (this.role === 'cron') {
            this.agentConfig = {...this.agentConfig, mode: 'agent'};
        }
        this.sessionDir = SessionService.getSessionDir(this.role, this.agentId, this.projectId, this.spawned);
        this.loadSessionData();
        this.llm = new (this.getLLMConstructor())(
            this.loopKind(),
            this.role,
            this.agentConfig.llm,
        ) as LLM;
    }

    protected abstract getLLMProtocol(): LLMProtocol;

    private loadSessionData(): void {
        const {history, outdated} = SessionService.loadSession<I>({
            sessionDir: this.sessionDir,
            agentId: this.agentId,
            projectId: this.projectId,
            loopId: this.getId(),
            loopKind: this.loopKind(),
            llmProtocol: this.getLLMProtocol()
        });
        this.history = history;
        this.outdated = outdated;
        this.historyPersistIndex = this.history.length;
    }

    public getSessionDir(): string {
        return this.sessionDir;
    }

    public updateAgentConfig(config: AgentConfig): void {
        const oldLLMConfig = this.agentConfig.llm;
        const newLLMConfig = config.llm;
        this.agentConfig = config;
        let newClient = null;
        if (oldLLMConfig.baseURL !== newLLMConfig.baseURL
            || oldLLMConfig.apiKey !== newLLMConfig.apiKey
        ) {
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

    protected loopKind(): LoopKind {
        return this.spawned?.kind ?? 'main';
    }

    /**
     * A picture drawn inside a sub loop only reaches a user when the loop that spawned it names
     * the reference, and a summary written by a model cannot be trusted to repeat a hash.
     */
    public getDrawnImages(): string[] {
        return [...new Set(this.footPrints
            .filter(footPrint => footPrint.type === IMAGE_FOOT_PRINT)
            .map(footPrint => footPrint.content))];
    }

    public isOutdated(): boolean {
        return this.outdated;
    }

    protected abstract getLLMConstructor(): LLMConstructor<I, O, unknown, unknown>;

    protected async _invoke(input: string, options: AgentInvokeOptions): Promise<AgentInvokeResponse> {
        this.addUserMessage(input, options.images);
        this.externalInterruptReason = undefined;
        this.runInteraction = options.agentHandler?.onInteractionEvent;
        // Being asked for a run is a reason to believe somebody is there again, so the loop goes back
        // to asking. A spawned loop is nobody: its run is a part of the one that found the silence.
        if (this.loopKind() === 'main') {
            ToolUseService.clearAwayUser(this.getId());
        }
        const state: LoopState<I> = {
            messages: this.history,
            oneLoopContext: this.initContext(options)
        };
        // Named here rather than where the conversation is closed, since by then the first thing
        // asked of it is buried in a history whose shape is the protocol's rather than ours.
        SessionService.nameSession(state.oneLoopContext, input);
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
            try {
                await HookManager.emitVisitor('postLoopEnd', state.oneLoopContext);
            } finally {
                SessionService.saveHistory(this.history, state.oneLoopContext, {
                    finalText, usage: runtime.usage
                }, true);
                this.historyPersistIndex = runtime.historyPersistIndex;
            }
        }
    }

    private initContext(options: AgentInvokeOptions): OneLoopContext {
        return {
            role: this.role,
            loopId: this.getId(),
            loopKind: this.loopKind(),
            agentId: this.agentId,
            // Read once, so the whole run works with the memory and the skills it started with even
            // if the task is handed to somebody else while it is on.
            personaId: PromptService.taskAssignee(this.assignedTask())?.id,
            projectId: this.projectId,
            loopConfig: this.agentConfig,
            browserId: options.browserId,
            sessionDir: this.sessionDir,
            system: {cacheable: '', learned: '', dynamic: ''},
            logger: getLoopLogger(this.getId(), this.spawned?.runId),
            actions: {
                newTaskLoop: this.createTaskLoop.bind(this),
                newSubLoop: this.createSubLoop.bind(this),
                addFootPrint: (footPrint: FootPrint) => this.footPrints.push(footPrint),
                agentHandler: {
                    ...this.agentHandler, ...options.agentHandler
                },
                addStringMessage: this.addStringMessage.bind(this),
            },
            permissionWhiteList: this.permissionWhiteList,
            runtime: {
                ...this.emptyRuntime(),
                historyPersistIndex: this.historyPersistIndex,
            }
        }
    }

    private async agentLoop(state: LoopState<I>): Promise<string> {
        while (true) {
            const runtime = state.oneLoopContext.runtime;
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
                this.role, this.projectId, this.loopKind(), this.assignedTask()
            );
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
        await HookManager.emitVisitor('preTurnStart', state.oneLoopContext);

        await this.compactIfNeeded(state.oneLoopContext);
        const response = await this.llm.invoke(
            state.oneLoopContext.loopConfig.mode,
            state.oneLoopContext.system,
            state.messages,
            (text: string) => this.agentHandler.onStreamText({
                browserId: state.oneLoopContext.browserId,
                text
            }),
            state.oneLoopContext.logger
        );

        this.addUsage(state.oneLoopContext, response);

        runtime.turnCount++;
        runtime.transitionReason = response.transitionReason;

        switch (runtime.transitionReason) {
            case 'toolUse': {
                const results = await this.runTools(
                    this.extractToolUseFromResponse(response), state.oneLoopContext
                );
                this.convertToolResultMessages(results).forEach(msg => state.messages.push(msg));
                break;
            }
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
        return !isStopTransitionReason(runtime.transitionReason) && !runtime.agentBreakReason;
    }

    private addUsage(context: OneLoopContext, response: O): void {
        const tokenUsage = this.llm.getTokenUsage(response);
        addTokenUsage(context.runtime.usage, tokenUsage);
    }

    private async runTools(toolUseDefs: ToolUseDef[], context: OneLoopContext): Promise<ToolUseResult[]> {
        const results: ToolUseResult[] = [];
        const groups = ToolUseService.planExecutionGroups(toolUseDefs, context);
        for (const group of groups) {
            const runs = await Promise.all(group.map(toolUseDef => this.runOneTool(toolUseDef, context)));
            results.push(...runs.map(run => run.result));
        }
        return results;
    }

    private async runOneTool(toolUseDef: ToolUseDef, context: OneLoopContext): Promise<ToolRunResult> {
        const breakReason = context.runtime.agentBreakReason;
        if (isAgentStopReason(breakReason) || isExternalInterruptReason(breakReason)) {
            const stopType = isAgentStopReason(breakReason) ? 'agentStop' : 'externalInterrupt';
            const stopText = i18nInstance.t(`agent.agentBreak.${stopType}.${breakReason}.llm`);
            return {
                toolUseDef,
                result: {
                    id: toolUseDef.id,
                    content: `Tool call execution skipped because loop terminated due to: ${stopText}`
                }
            };
        }
        await HookManager.emitVisitor('preEachToolUse', context, toolUseDef);
        const result = await HookManager.emitInterceptor('preEachToolUse', context, toolUseDef);
        if (result && result.result === 'stop') {
            return {
                toolUseDef,
                result: {id: toolUseDef.id, content: result.stopReason || 'Tool use rejected by hook.'}
            };
        }
        const toolResult = await ToolUseService.executeToolCall(toolUseDef, context);
        await HookManager.emitVisitor('postEachToolUse', context, {toolUseDef, result: toolResult});
        return {toolUseDef, result: toolResult.result};
    }

    protected addStringMessage(message: string, user: boolean = true): void {
        this.history.push(this.llm.newInputMessage(message, user));
    }

    protected addUserMessage(message: string, images?: ImageContent[]): void {
        if (images && images.length > 0) {
            this.history.push(this.llm.newImageInputMessage(this.namingImages(message, images), images));
        } else {
            this.addStringMessage(message);
        }
    }

    /**
     * The bytes of a picture reach the model, its reference does not: it is swapped for them on the
     * way out. Naming it beside the picture is what lets the model hand that picture to a tool later.
     */
    private namingImages(message: string, images: ImageContent[]): string {
        const refs = images.map(image => image.url).filter(url => isImageRef(url));
        return refs.length ? `${message}\n${refs.map(ref => `[image ${ref}]`).join('\n')}` : message;
    }

    protected extractFinalText(messages: I[]): string {
        return messages.length === 0 ? '' :
            this.llm.getTextFromInputMessage(messages[messages.length - 1]!);
    }

    // For stop button in the future
    public setExternalInterruptReason(reason: ExternalInterruptReason): void {
        this.externalInterruptReason = reason;
    }

    protected abstract extractToolUseFromResponse(result: O): ToolUseDef[];

    protected abstract convertToolResultMessages(toolResults: ToolUseResult[]): I[];

    /**
     * One task of the project, handed to a loop of its own. It is the loop that spawns loops in
     * turn: a task worth handing over is rarely one thing, and a sub loop that cannot hand anything
     * on leaves every piece of it to be done one after the other.
     */
    public createTaskLoop(assignedTask: AssignedTask): LoopAgent<I, O, LLM> {
        if (this.loopKind() !== 'main') {
            throw new Error(`A ${this.loopKind()} loop cannot create a task loop.`);
        }
        return this.spawn({kind: 'task', runId: randomUUID(), assignedTask});
    }

    /** The end of the chain: it works the prompt it was handed and answers with what came of it. */
    public createSubLoop(): LoopAgent<I, O, LLM> {
        if (this.loopKind() === 'sub') {
            throw new Error('A sub loop cannot create a sub loop.');
        }
        return this.spawn({kind: 'sub', runId: randomUUID(), assignedTask: this.assignedTask()});
    }

    /**
     * Nothing a spawned loop streams belongs to the user: it answers to the loop that spawned it,
     * and text of its own under the loop id they share would read as an answer of that loop. What
     * it has to ask and what it changed do travel on, there is nobody else to hear either.
     */
    private spawn(spawned: Omit<SpawnedLoop, 'permissionWhiteList'>): LoopAgent<I, O, LLM> {
        return this.newLoop(this.role, this.agentId, this.projectId, {
            onStreamText: () => {},
            onInteractionEvent: async (event: AgentInteractionEvent) => this.askOfThisRun(event),
            onInfoEvent: (event: AgentInfoEvent) => this.agentHandler.onInfoEvent(event),
        }, {...spawned, permissionWhiteList: this.permissionWhiteList});
    }

    /** Through the run in progress where it brought a way of its own, the loop's own way otherwise. */
    private askOfThisRun(event: AgentInteractionEvent): Promise<string> {
        if (this.runInteraction) {
            return this.runInteraction(event);
        }
        return this.agentHandler.onInteractionEvent(event);
    }

    private assignedTask(): AssignedTask | undefined {
        return this.spawned?.assignedTask;
    }

    protected abstract newLoop(
        role: FlushAgentRole,
        agentId: string,
        projectId: string,
        agentHandler: AgentHandler,
        spawned?: SpawnedLoop,
    ): LoopAgent<I, O, LLM>;
}
