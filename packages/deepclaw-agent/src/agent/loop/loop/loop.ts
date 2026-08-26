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
    type TokenUsage,
    type AgentRuntime,
} from '@deepclaw/core';
import { ToolUseResult, ToolUseDef } from '../../definitions/tool-definitions';
import {
    AssignedTask, FootPrint, IMAGE_FOOT_PRINT, isRunStopped, LLMProtocol, LoopKind, LoopState,
    OneLoopContext, PermissionWhiteList, SpawnedLoop,
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
import { LLMWindowService, type WindowBudget } from '../services/llm-window-service';
import { estimateTokens } from '../../loop-utils';

type ToolRunResult = {
    toolUseDef: ToolUseDef;
    result: ToolUseResult;
}

/** A turn that got somewhere: the model asked for a tool, or answered. */
const PROGRESS_TRANSITION_REASONS: LLMTransitionReason[] = ['toolUse', 'endLoop'];

export abstract class LoopAgent<I, O extends { transitionReason: LLMTransitionReason },
    LLM extends LLMModel<I, O, unknown, unknown>> extends FlushAgent {
    protected llm: LLM;
    private turnLimit: number = 100;
    private maxTokenRetries: number = 3;
    private maxInputTokenRetries: number = 3;
    private historyPersistIndex: number = 0;
    private sessionDir: string;
    private history: I[] = [];
    private outdated: boolean = false;
    /**
     * How many tokens the last request came to, as the model itself counted them, and undefined
     * where nothing measured still describes what the next request will be.
     *
     * The only exact measure of the history there is. Everything else here counts bytes, which
     * stand for tokens at a rate that is four to one in code and one to one in Chinese, so a
     * threshold in bytes is a threshold that means something different per conversation. It lags a
     * turn behind by nature -- it describes the request that was already answered -- and the
     * margin is what covers the difference; a compaction in between is what invalidates it
     * outright.
     *
     * Absent rather than zero for the unmeasured case. A request of no tokens is not a thing that
     * happens, so zero would read as unknown well enough, but it would read that way by a fact
     * about the domain rather than anything the type says -- and the budget it is weighed against
     * spells its own unknown `undefined`, so one expression would have been saying the same word
     * two ways.
     */
    private lastInputTokens: number | undefined;
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
            oneLoopContext: this.initContext(options),
            said: ''
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
            abortSignal: options.abortSignal,
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
        const notice = i18nInstance.t(`agent.agentBreak.${type}.${flag}.user`);
        return text ? `${text}\n\n${notice}` : notice;
    }

    /**
     * Whether the history has grown past what the far end will take, in tokens.
     *
     * What is weighed is the request that was already answered, not the one about to be sent. That
     * lag looks like a flaw and is the one thing here that lets a window be found: the count is
     * exact, but it is a turn old, so a request routinely goes out larger than the budget by
     * whatever the last turn added -- and it is those requests, larger than anything allowed on
     * purpose, that prove the window wider than the budget and let the budget follow. Weighed
     * against the history as it stands, the gate would bind every turn and nothing would ever
     * outgrow it, which is a conversation held at the starting guess for good.
     *
     * The other half of the question is asked in bytes, inside the compaction, where the history is
     * serialized anyway. Neither unit converts into the other at any rate worth trusting.
     */
    private overTokenBudget(budget: WindowBudget): boolean {
        return this.lastInputTokens !== undefined && this.lastInputTokens > budget.tokens;
    }

    private async compactIfNeeded(context: OneLoopContext, force: boolean = false): Promise<void> {
        const compactor = MessageCompactor.getCompactor(this.getLLMProtocol());
        if (!this.outdated) {
            compactor.compactOldResults(this.history, context);
        }
        const budget = LLMWindowService.budgetOf(this.agentId, this.llm.modelName());
        await compactor.compactFullHistory(
            this.outdated || force || this.overTokenBudget(budget),
            context, this.footPrints, this.llm, this.history, budget
        );
        if (this.outdated) {
            // Only here, the call above having come back: the history is in the shape of this model
            // at last. Anything that cut that call short -- a stop above all -- has thrown past
            // this instead, leaving both the loop and the session on the old protocol, so that the
            // next run is the migration over again rather than the old messages sent to a model
            // that answers them with an error.
            //
            // Written out before the session is told, and in that order: the summary lives in
            // memory alone until the turn ends, a whole llm call and every tool of it away, and a
            // process that goes down inside that gap -- a restart, a kill, a machine -- would leave
            // a session claiming a migration whose messages on disk are still the old ones, which
            // is the same conversation refused for good by the model it was migrated to. Forced,
            // since the turn that migrates is often the first of the session and a save waits for
            // a turn to have been counted.
            this.outdated = false;
            SessionService.saveHistory(this.history, context, {}, true);
            SessionService.markHistoryProtocol(context, this.getLLMProtocol());
        }
    }

    /**
     * Clears both counts of a recovery, once the run has actually got somewhere.
     *
     * The counters are there to stop a recovery that is not recovering -- a compaction that does
     * not bring the history under the window, a continuation that runs out of output again -- and
     * that is a thing that happens in a row. Left to accumulate over a whole run they would count
     * something else: a long conversation hits the input limit, is summarized, runs on for thirty
     * turns, and grows back into it, which is not a failure but the ordinary rhythm of a
     * conversation whose real window is narrower than the byte guess. Three of those in a hundred
     * turns is nothing remarkable, and killing the run on the third would be killing it for
     * lasting.
     *
     * What clears them is progress and not merely the absence of the one limit each counts. Were
     * each cleared whenever the other fired, a run alternating between the two would reset both
     * forever and neither would ever reach three: two limits taking turns is not a recovery, and
     * the only thing left to end such a run would be the turn limit, a hundred llm calls away.
     * A turn that ends in a tool call or an answer is the run getting somewhere; anything else is
     * the run trying again.
     */
    private forgetRecoveredRetries(runtime: AgentRuntime): void {
        if (!PROGRESS_TRANSITION_REASONS.includes(runtime.transitionReason!)) {
            return;
        }
        runtime.recoveryState.inputMaxTokenRetries = 0;
        runtime.recoveryState.maxTokenRetries = 0;
    }

    private async runOneTurn(state: LoopState<I>): Promise<boolean> {
        const context = state.oneLoopContext;
        const runtime = context.runtime;
        // What the model said this turn, and whether the history already holds it. A turn cut
        // short pushes no message of its own, so without this the words that reached the user
        // would be gone from both the chat and the history the next turn is built from. Kept
        // beside the words of the whole run rather than in place of them: only this turn's belong
        // in the history, where the earlier ones are already written, and only the run's are what
        // the user is looking at, a turn the model has said nothing in yet having nothing to show.
        let said = '';
        let saved = false;
        try {
            await HookManager.emitVisitor('preTurnStart', context);

            // Inside the try on purpose: compaction is itself an LLM call, the slowest one a long
            // conversation makes, and a stop landing in it must end the run the same way a stop
            // landing in the turn does rather than throwing its way out as a failure.
            await this.compactIfNeeded(context);
            const response = await this.llm.invoke(
                context.loopConfig.mode,
                context.system,
                state.messages,
                (text: string) => {
                    said += text;
                    state.said += text;
                    this.agentHandler.onStreamText({browserId: context.browserId, text});
                },
                context.logger,
                context.abortSignal
            );
            saved = true;

            this.addUsage(context, response);

            runtime.turnCount++;
            runtime.transitionReason = response.transitionReason;
            this.forgetRecoveredRetries(runtime);

            switch (runtime.transitionReason) {
                case 'toolUse': {
                    const results = await this.runTools(
                        this.extractToolUseFromResponse(response), context
                    );
                    this.convertToolResultMessages(results).forEach(msg => state.messages.push(msg));
                    break;
                }
                case 'inputMaxTokens':
                    // Forced, and counted. Forced because the model refusing the call is the only
                    // true measure of what it holds, and a history under the threshold would
                    // otherwise come back from here untouched and be refused again every turn to
                    // the limit. Counted because a compaction that does not bring the history under
                    // the limit -- a system prompt and a tool set too big between them, a summary
                    // still too long -- would otherwise summarize a summary for just as long, at an
                    // llm call apiece rather than a refusal apiece.
                    runtime.recoveryState.inputMaxTokenRetries++;
                    if (runtime.recoveryState.inputMaxTokenRetries >= this.maxInputTokenRetries) {
                        runtime.transitionReason = 'error';
                        // Said out loud, because a refusal is the one error whose response never
                        // reaches the history: the llm keeps it out so that the compaction has an
                        // untouched conversation to work on. Every other error path leaves its own
                        // words there and the final text is read off the last of them, so giving
                        // up silently here would hand back whatever the compaction left behind --
                        // the user's own question, or the whole of the summary -- as if it were an
                        // answer to it.
                        this.addStringMessage(i18nInstance.t('agent.contextTooLong'), false);
                        break;
                    }
                    await this.compactIfNeeded(context, true);
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
        } catch (error) {
            // A stop is the only thing absorbed here. Anything else is a real failure and goes on
            // to the error path it always took: read as a stop it would tell the user they pressed
            // a button nobody pressed, and bury whatever actually went wrong.
            if (!isRunStopped(context)) {
                throw error;
            }
        }
        try {
            const stopping = this.stoppingReason(context);
            if (stopping) {
                this.endStoppedTurn(state, stopping, said, saved);
            }
            this.externalInterruptReason = undefined;
        } finally {
            await HookManager.emitVisitor('postTurnEnd', context);
            SessionService.saveHistory(this.history, context);
        }
        return !isStopTransitionReason(runtime.transitionReason) && !runtime.agentBreakReason;
    }

    /**
     * Why this turn ends short, where anything asks it to.
     *
     * Two things can say so and both are read. The flag is set on the loop the stop was addressed
     * to, which is only ever the topmost one: a loop it spawned is never told and has the signal
     * alone to go by, so leaving the signal out here would leave a sub loop no way to end the way
     * this one does and it would throw its way out as a failure instead.
     *
     * A run that answered of its own accord has answered: the stop and the last word of the model
     * crossed in flight, and the word that arrived is the one that counts.
     */
    private stoppingReason(context: OneLoopContext): ExternalInterruptReason | undefined {
        const runtime = context.runtime;
        if (isStopTransitionReason(runtime.transitionReason) || isAgentStopReason(runtime.agentBreakReason)) {
            return undefined;
        }
        return this.externalInterruptReason ?? (isRunStopped(context) ? 'userStopped' : undefined);
    }

    /**
     * Closes a turn that was stopped rather than finished.
     *
     * The model is left an assistant message either way. A history ending on the user, or one
     * carrying a tool_use with no result to match, is one the next call is refused for, and a turn
     * cut short leaves both. Where the words of the model never made it into the history they are
     * that message; where they did, or where there were none, a line saying the run was stopped
     * stands in, since a message with nothing in it is refused just as surely.
     *
     * What the user reads is settled here too, and it is deliberately not that message: the line
     * above is written for the model, and reading it back would put two sentences saying the very
     * same thing one after the other. They read back everything the run said to them, followed by
     * the one notice, or the notice alone where it never said anything. Everything, and not the
     * words of this turn alone: a stop lands as easily in a turn opened after a tool call, which
     * the model may enter without a word to say, and answering the run with a bare notice there
     * would take back off the screen every line it had put on it.
     */
    private endStoppedTurn(
        state: LoopState<I>, reason: ExternalInterruptReason, said: string, saved: boolean
    ): void {
        const runtime = state.oneLoopContext.runtime;
        runtime.agentBreakReason = reason;
        runtime.agentBreakDetail = this.wrapAgentBreakMessage(state.said, 'externalInterrupt', reason);
        const notice = i18nInstance.t(`agent.agentBreak.externalInterrupt.${reason}.llm`);
        this.history.push(this.llm.newInputMessage(saved ? notice : (said || notice), false));
    }

    private addUsage(context: OneLoopContext, response: O): void {
        const tokenUsage = this.llm.getTokenUsage(response);
        addTokenUsage(context.runtime.usage, tokenUsage);
        this.recordWindow(tokenUsage);
    }

    /**
     * What this turn found out about the limits of the far end.
     *
     * Both readings come off the same turn and are recorded together. The cached tokens count
     * toward the size of the request as much as the rest: the cache makes them cheaper, not
     * absent, and leaving them out would have the history read smaller than it is by exactly the
     * part that a long conversation is mostly made of.
     */
    private recordWindow(tokenUsage: TokenUsage): void {
        const model = this.llm.modelName();
        const inputTokens = tokenUsage.cachedInputTokens + tokenUsage.noCachedInputTokens;
        const refused = this.llm.takeObservedLimit();
        if (refused) {
            // The estimate matters only where the refusal named no figure, and there it is all
            // there is: see `narrowOnSilence`. Measured off the same serialization the compaction
            // weighs, which leaves out the system prompt and the tool schemas that rode along --
            // so it reads the refused request as smaller than it was, and a ceiling read from it
            // lands under the wall rather than over. The safe side of the two.
            LLMWindowService.observeRefused(
                this.agentId, model, refused, estimateTokens(this.serializedHistory())
            );
            // A refused call answers with a synthetic response whose usage is zeros, so there is
            // no width to prove here and reading it as one would put the lower bound on the floor.
            //
            // What is dropped instead is the size of the request before this one. A refusal is
            // followed at once by a compaction, and the turn after that would otherwise weigh a
            // history of two messages against a measurement of the history that was refused --
            // which is a measurement above the margin by definition, that being why it was
            // refused -- and summarize the summary. Nothing is known about the size of what comes
            // next until a call carries it, which is the next turn's to record.
            this.lastInputTokens = undefined;
            return;
        }
        this.lastInputTokens = inputTokens;
        LLMWindowService.observeAccepted(this.agentId, model, inputTokens);
    }

    private serializedHistory(): string {
        return this.history.map(message => JSON.stringify(message)).join('\n');
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
        const stopText = this.skipReason(context);
        if (stopText) {
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

    /**
     * What the model is told in place of a tool that was never run, or nothing where the run is
     * still going. A break reason is only written at the end of a turn, so a stop landing while
     * the tools of this turn are running is nowhere to be read but the signal, and it has to name
     * itself: the reason it would have been looked up under is not there yet.
     */
    private skipReason(context: OneLoopContext): string {
        const breakReason = context.runtime.agentBreakReason;
        if (isAgentStopReason(breakReason) || isExternalInterruptReason(breakReason)) {
            const stopType = isAgentStopReason(breakReason) ? 'agentStop' : 'externalInterrupt';
            return i18nInstance.t(`agent.agentBreak.${stopType}.${breakReason}.llm`);
        }
        return isRunStopped(context)
            ? i18nInstance.t('agent.agentBreak.externalInterrupt.userStopped.llm') : '';
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
