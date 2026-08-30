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
    streamShape,
    type ImageContent,
    type SealedAgentHandler,
    type TokenUsage,
    type AgentRuntime,
} from '@deepclaw/core';
import { ToolUseResult, ToolUseDef } from '../../definitions/tool-definitions';
import {
    AssignedTask, CARRIED_FOOT_PRINTS, CarriedLoopState, CHANGE_FOOT_PRINTS, feelerOf, FootPrint,
    IMAGE_FOOT_PRINT, isRunStopped, isSpawnedLoop, LLMProtocol, LoopKind, LoopState, OneLoopContext,
    PermissionWhiteList, SpawnedLoop,
} from '../../definitions/definitions';
import { AgentFeelingService } from '../services/agent-feeling-service';
import { ToolUseService } from '../services/tool-use-service';
import { PromptService } from '../services/prompt-service';
import { LLMModel, LLMConstructor } from '../../llm/llmgw';
import { getLoopLogger } from '@deepclaw/node-utils';
import { HookManager } from '../services/hook-manager';
import { AgentConfig, loadAgentConfig } from '@deepclaw/config';
import { agentProtocolOf } from '../../loop-protocol-detector';
import { MessageCompactor } from '../compactor/messages-compactor';
import { AgentIdentityManager } from '../services/agent-identity-manager';
import { SessionService } from '../services/session-service';
import { pauseHandWork, resumeHandWork } from '../services/running-task-service';
import { LLMWindowService, type WindowBudget } from '../services/llm-window-service';
import { estimateTokens } from '../../loop-utils';

type ToolRunResult = {
    toolUseDef: ToolUseDef;
    result: ToolUseResult;
}

/** How a run ends, in the two shapes it is read in; see `AgentInvokeResponse`. */
type RunEnding = Omit<AgentInvokeResponse, 'runtime'>;

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
     * one. A spawned loop works with the list of the loop that spawned it, and a loop standing in
     * for one the gateway dropped is handed the list of that one; a rebuild that means to start
     * over -- another provider -- is the only one that asks again.
     */
    private readonly permissionWhiteList: PermissionWhiteList;

    /**
     * `carried` is what a loop the gateway let go of left behind, and belongs only to that one
     * caller. The same constructor builds the loop that replaces one retired over a protocol
     * change, which is meant to begin with none of this.
     */
    constructor(
        role: FlushAgentRole,
        agentId: string,
        projectId: string,
        handler: AgentHandler,
        spawned?: SpawnedLoop,
        carried?: CarriedLoopState,
    ) {
        super(role, agentId, projectId, handler);
        this.spawned = spawned;
        this.permissionWhiteList = spawned?.permissionWhiteList
            ?? carried?.permissionWhiteList ?? new Set();
        this.lastInputTokens = carried?.lastInputTokens;
        this.footPrints = carried?.footPrints ?? [];
        // Whose model does the work, which is not always whose name is on the run: a task is worked
        // on by the agent it was assigned to, under the id of the loop that handed it over.
        this.agentConfig = loadAgentConfig(spawned?.runAs ?? this.agentId);
        // A run that works rather than talks is in agent mode whatever the config says. A scheduled
        // run has nobody to talk to; a spawned one was handed its work by a loop that had to be in
        // agent mode to have the tool at all, and an assignee left in chat mode would otherwise be
        // given a task and none of the tools to do it with.
        if (this.role === 'cron' || isSpawnedLoop(this.loopKind())) {
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
            || oldLLMConfig.protocol !== newLLMConfig.protocol
        ) {
            // The protocol is the class of this loop, which a running one cannot be talked out of:
            // it is left for the gateway to build again. Asked of the whole llm config rather than
            // of the url alone, because a protocol picked by hand is a change no url shows -- and
            // a pick that lands on what the url already said is no change at all.
            if (agentProtocolOf(oldLLMConfig) !== agentProtocolOf(newLLMConfig)) {
                this.outdated = true;
            } else {
                newClient = {
                    baseURL: newLLMConfig.baseURL,
                    apiKey: newLLMConfig.apiKey,
                }
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

    /**
     * What the run changed, in the order the run has it and with every repeat kept -- a command
     * run three times is a run that tried three times. Read off a spawned loop that ended with
     * nothing to show for itself, where the loop above would otherwise have no way of knowing
     * whether the work had been half done in its own files or never begun.
     *
     * The order is when each step landed here, which for a step of the run itself is when it was
     * taken and for a step of a subagent is when the subagent came back: what a whole branch did
     * arrives at once, at the end of it, however long it had been at work.
     *
     * What it read is no part of this, and the pictures it drew are not either. The files stay out
     * because the account is cut to the last of it and a run looks at ten things for every one it
     * touches; the pictures because they reach the same reader on a path of their own.
     */
    public getChangeTrace(): FootPrint[] {
        return this.footPrints.filter(footPrint => CHANGE_FOOT_PRINTS.includes(footPrint.type));
    }

    public isOutdated(): boolean {
        return this.outdated;
    }

    /**
     * What this loop would hand over to one built in its place, for the gateway to hold on to while
     * there is no loop holding it. Read at the moment it is let go of: the history behind it is on
     * disk and reads itself back, and these three are what would otherwise go with it.
     */
    public carriedState(): CarriedLoopState {
        return {
            permissionWhiteList: this.permissionWhiteList,
            lastInputTokens: this.lastInputTokens,
            footPrints: this.carriedFootPrints(),
        };
    }

    /**
     * The kinds something on the other side of an eviction reads, each of them once. A run comes
     * back to the same handful of files all day -- reads one, edits it, reads it back -- and the
     * trace says so every time, which costs nothing while it dies with the loop: both readers of
     * what is carried take a set of the contents anyway, so a repeat has never carried anything
     * either of them could use. Handed on it would outlive every loop that ever held it, and grow
     * with how long a conversation has been talked in rather than with how much of it there is to
     * say.
     *
     * The changes are dropped rather than deduplicated, having no reader here at all: what reads
     * them is the account a spawned loop gives of itself, which wants the repeats and reads the
     * live list. A spawned loop is torn down whole rather than evicted, so it never gets this one.
     */
    private carriedFootPrints(): FootPrint[] {
        const seen = new Set<string>();
        return this.footPrints.filter(footPrint => {
            if (!CARRIED_FOOT_PRINTS.includes(footPrint.type)) {
                return false;
            }
            const key = `${footPrint.type}\n${footPrint.content}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
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
        let ending: RunEnding = {text: '', said: ''};
        // A turn of a loop that holds a task of its own begins and ends here rather than wherever
        // this run was asked for. What starts a loop is more than one thing -- a browser, a cron
        // task, whatever a test reaches for -- and a hold turned into a run by only one of them is
        // a card left spinning for a run that ended, which the user can then neither close nor hand
        // out. The turn is the loop's own to know, and this is where the loop knows it.
        //
        // Only a loop that can hold work is asked. A spawned loop answers under the loop id of the
        // one that spawned it, so a turn of one would put the hold of the loop above it up and take
        // it down again in the middle of the turn that is still running up there.
        const holdsWork = this.loopKind() === 'main';
        if (holdsWork) {
            resumeHandWork(state.oneLoopContext);
        }
        try {
            SessionService.updateSessionRuntime(state.oneLoopContext, {status: 'running'});
            ending = this.trimmed(await this.agentLoop(state));
            return {...ending, runtime};
        } catch (error) {
            const msg = `Error in loop, ${error instanceof Error ? error.message : 'Unknown error.'}`;
            runtime.transitionReason = 'error';
            runtime.agentBreakReason = undefined;
            state.oneLoopContext.logger.error(error, msg);
            ending = this.trimmed({text: msg, said: this.saidWith(state.said, msg)});
            return {...ending, runtime};
        } finally {
            try {
                await HookManager.emitVisitor('postLoopEnd', state.oneLoopContext);
            } finally {
                // The line under a closed conversation is read rather than watched, so it is the
                // answer that stands there and not the run that arrived at it.
                SessionService.saveHistory(this.history, state.oneLoopContext, {
                    finalText: ending.text, usage: runtime.usage
                }, true);
                this.historyPersistIndex = runtime.historyPersistIndex;
                if (holdsWork) {
                    pauseHandWork(state.oneLoopContext);
                }
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

    private async agentLoop(state: LoopState<I>): Promise<RunEnding> {
        while (true) {
            const runtime = state.oneLoopContext.runtime;
            if (runtime.turnCount >= this.turnLimit) {
                runtime.transitionReason = 'endLoop';
                // Written down as well as worded, because the reason alone cannot tell this ending
                // from a run that finished what it was doing: both of them end the loop, and only
                // one of them was in the middle of something when the count ran out.
                runtime.hitTurnLimit = true;
                const notice = i18nInstance.t('agent.maxTurnReached');
                const said = this.appended(state.said, notice);
                // Only what the stream has not carried yet, which is the notice and the space
                // before it. Sent whole, the words above it would be read a second time from the
                // moment the run ended until the message written from `said` landed over them.
                this.agentHandler.onStreamText({
                    browserId: state.oneLoopContext.browserId,
                    text: said.slice(state.said.length)
                });
                // The reader handed the answer alone has nothing else of the run, so the last thing
                // the model said is given to them with the notice under it -- the same way round as
                // every other ending words itself, an ending being no use above the words it ends.
                // The chat has those words already and is given the notice alone.
                const last = this.extractFinalText(state.messages);
                return {text: this.appended(last, notice), said};
            }
            state.oneLoopContext.system = PromptService.provideSystemPrompt(
                this.agentConfig, AgentIdentityManager.getAgent(this.agentId),
                this.role, this.projectId, this.loopKind(), this.assignedTask()
            );
            const goAround = await this.runOneTurn(state);
            if (!goAround) {
                return this.endOfRun(state);
            }
        }
    }

    /**
     * How the run ends, worded for both of its readers.
     *
     * The two differ in what the ending is written after, and only there: everything the run said
     * for the chat that watched it say so, the last thing it said for whoever is handed the answer
     * alone. A notice is the part neither reader was ever streamed -- a project left for the user
     * to look at, a stop, a failure the model never got to word -- so it is added to both, and a
     * run ending on its own words needs nothing added to either.
     */
    private async endOfRun(state: LoopState<I>): Promise<RunEnding> {
        const runtime = state.oneLoopContext.runtime;
        const last = this.extractFinalText(state.messages);
        if (runtime.transitionReason === 'error') {
            await HookManager.emitVisitor('turnError', state.oneLoopContext);
            // The words a failing turn left were streamed as they came; the ones standing in for
            // a turn that left none, or refused before it began, reach the reader from here alone.
            const text = last || i18nInstance.t('common.unexpected');
            return {text, said: this.saidWith(state.said, text)};
        }
        if (isAgentStopReason(runtime.agentBreakReason)) {
            // A detail is what whatever stopped the run had to say about it, and it answers for the
            // whole of the run: nothing of the run is put in front of it, the last message under a
            // break like this being as often a tool result as a sentence. Only where there is none
            // does the run end on a line of its own, and then the words are worth reading first.
            const detail = runtime.agentBreakDetail;
            const notice = detail || this.agentBreakNotice('agentStop', runtime.agentBreakReason);
            return {
                text: detail || this.appended(last, notice),
                said: this.appended(state.said, notice),
            };
        }
        if (isExternalInterruptReason(runtime.agentBreakReason)) {
            await HookManager.emitVisitor('externalInterrupt', state.oneLoopContext, runtime.agentBreakReason);
            // A stop has no answer of its own, so both readers are given the run: everything it
            // said and the one notice. Everything, and not the words of this turn alone -- a stop
            // lands as easily in a turn opened after a tool call, which the model may enter
            // without a word to say, and a bare notice there would take back off the screen every
            // line the run had put on it.
            const stopped = this.appended(
                state.said, this.agentBreakNotice('externalInterrupt', runtime.agentBreakReason)
            );
            return {text: stopped, said: stopped};
        }
        return {text: last, said: state.said || last};
    }

    /**
     * Blank space at the end of a run, once, where the stream drops it: what closes a stream is
     * trimmed, and a run that ended on empty lines would otherwise leave them in the chat and in
     * the line under a closed conversation. Only at the end -- trimmed as it came, a chunk ending
     * on the space before the next word would lose it.
     */
    private trimmed(ending: RunEnding): RunEnding {
        return {text: ending.text.trimEnd(), said: ending.said.trimEnd()};
    }

    /**
     * Everything the run said with its ending after it, unless the ending is already the last of
     * what it said -- which it is whenever the model worded it, and never when the loop did.
     */
    private saidWith(said: string, ending: string): string {
        return said.trimEnd().endsWith(ending.trimEnd()) ? said : this.appended(said, ending);
    }

    private appended(text: string, notice: string): string {
        return text ? `${text}\n\n${notice}` : notice;
    }

    private agentBreakNotice(type: string, flag: AgentBreakReason): string {
        return i18nInstance.t(`agent.agentBreak.${type}.${flag}.user`);
    }

    /**
     * A turn of this agent has gone by, which is what ages the last thing it said it felt.
     *
     * Counted where a turn is counted, and not where the prompt shows that feeling back: a prompt
     * is built for other reasons than taking a turn, and one built for a compaction or a preview
     * would otherwise age a feeling nobody was shown. Only turns worked in somebody's name count,
     * and they are counted in that name: a task worked as somebody else ages what that agent said,
     * being the agent whose card the run is speaking from. A run that speaks from nobody's card
     * ages nothing, having nothing of anyone's to make look old.
     *
     * Whose name that is is feelerOf, whole, which is the same question the tool asks before it
     * takes a feeling and the "feels" of PromptService.provideSystemPrompt asks before a run is
     * offered one. Nothing of it is asked again out here: a run aged by turns it is never shown
     * drifts quietly, and a second copy of the rule is where that starts.
     */
    private ageFeeling(context: OneLoopContext): void {
        const feeler = feelerOf(context);
        if (feeler) {
            AgentFeelingService.aTurnPassed(feeler);
        }
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
        const budget = LLMWindowService.budgetOf(this.windowKeeper(), this.llm.modelName());
        const converted = await compactor.compactFullHistory(
            this.outdated || force || this.overTokenBudget(budget),
            context, this.footPrints, this.llm, this.history, budget
        );
        if (this.outdated && converted) {
            // Only here, the call above having come back with a summary: the history is in the
            // shape of this model at last. Anything that cut that call short -- a stop above all --
            // has thrown past this instead, and a summarizer that answered with anything but a
            // summary reports it, both leaving the loop and the session on the old protocol, so
            // that the next run is the migration over again rather than the old messages sent to a
            // model that answers them with an error. That is the whole of what the flag is for: a
            // session marked migrated is a session nothing will ever try to migrate again, and the
            // conversation under it stays unreadable to every model it is ever pointed at.
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
            const held = state.messages.length;
            const response = await this.llm.invoke(
                context.loopConfig.mode,
                context.system,
                state.messages,
                (raw: string) => {
                    // Kept in the shape it goes out in. What is held here is written down as the
                    // message once the run is over, and text of another shape is a message that
                    // reads as what was on the screen without being it.
                    const text = streamShape(raw);
                    said += text;
                    state.said += text;
                    this.agentHandler.onStreamText({browserId: context.browserId, text});
                },
                context.logger,
                context.abortSignal
            );
            saved = true;
            // The words of a turn reach the screen and `said` by being streamed, and an adapter
            // that hands them back in the response streams none: read afterwards, the run would be
            // one that never spoke -- the chat left holding the ending alone under a turn of work,
            // and the reader given the answer handed more of the run than the one who watched it.
            // The message the call pushed is those words, and here is the one moment it is the last
            // of the history: the results of the tools it asked for land under it further down.
            // Streamed as it is taken, so that what the chat is written is what was on the screen.
            //
            // Asked of what this call left behind and not of what happens to lie last, because a
            // call that pushes nothing is a real thing: a refusal is kept out of the history so the
            // compaction has an untouched conversation to work on. Read the other way, whatever the
            // turn opened on -- the user's own question, the whole of a summary, the line asking
            // the model to carry on from an output limit -- would be played back to them as the
            // agent speaking, and written into the chat as that.
            const spoke = state.messages.length > held;
            const unstreamed = said || !spoke ? '' : streamShape(this.extractFinalText(state.messages));
            if (unstreamed) {
                said = unstreamed;
                state.said += unstreamed;
                this.agentHandler.onStreamText({browserId: context.browserId, text: unstreamed});
            }

            this.addUsage(context, response);

            runtime.turnCount++;
            this.ageFeeling(context);
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
     * That message is written for the model and is read by nobody else: what the user is told is
     * worded in `endOfRun`, deliberately not from here, since reading this one back would put two
     * sentences saying the very same thing one after the other.
     */
    private endStoppedTurn(
        state: LoopState<I>, reason: ExternalInterruptReason, said: string, saved: boolean
    ): void {
        const runtime = state.oneLoopContext.runtime;
        runtime.agentBreakReason = reason;
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
                this.windowKeeper(), model, refused, estimateTokens(this.serializedHistory())
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
        LLMWindowService.observeAccepted(this.windowKeeper(), model, inputTokens);
    }

    /**
     * Whose lesson this is. What a window is learned about is an endpoint, and the agent talking to
     * it is the one whose config this loop was built to -- the assignee where a task is worked on
     * somebody else's model, and this loop's own agent everywhere else. Filed under the name on the
     * run instead, the width found by working a task would be learned by an agent that never made
     * the call, and the agent that did would go on finding it out again on every task it is handed.
     */
    private windowKeeper(): string {
        return this.agentConfig.id;
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
     *
     * The work is done by the model of the agent the task belongs to, which is why this one is not
     * always built here: a loop can only build its own kind, and an assignee of another vendor
     * speaks another protocol. Where the task is nobody's, or is the work of the agent handing it
     * over, there is nothing to pick and the shorter way is taken.
     */
    public async createTaskLoop(assignedTask: AssignedTask): Promise<LoopAgent<any, any, any>> {
        if (this.loopKind() !== 'main') {
            throw new Error(`A ${this.loopKind()} loop cannot create a task loop.`);
        }
        // Read once here, as the assignee behind the prompt of the run is: a task handed to
        // somebody else halfway through is worked on by whoever it belonged to at the start.
        //
        // The name the board holds, and not the agent it was looked up to: an assignee that has
        // been deleted from the configuration answers to nobody, and reading this as "then nobody
        // owns it" would put the task on the model of the loop handing it over -- silently, the one
        // thing the refusal below exists to prevent. Named here, it is refused by name down there.
        const runAs = PromptService.taskAssigneeId(assignedTask);
        const spawned = {kind: 'task' as const, runId: randomUUID(), assignedTask, runAs};
        if (!runAs || runAs === this.agentId) {
            return this.spawn(spawned);
        }
        return this.spawnAs(runAs, spawned);
    }

    /**
     * Asked for where it is used rather than named at the top of the file: what knows every kind of
     * loop is what builds this one, so it knows this one too, and a module naming it up there would
     * be asked for a class still being defined. The cron service reaches for it the same way.
     */
    private async spawnAs(
        runAs: string, spawned: Omit<SpawnedLoop, 'permissionWhiteList'>
    ): Promise<LoopAgent<any, any, any>> {
        const {LoopInitializer} = await import('../../loop-initializer');
        try {
            return LoopInitializer.getSpawnedLoop(
                this.role, this.agentId, this.projectId, this.spawnedHandler(), this.asRun(spawned)
            );
        } catch (error) {
            // Never quietly on this loop's own model instead. Whoever reads this picked the
            // assignee, and a task worked by a model they did not choose is worse than one refused.
            // The cause is held apart rather than run on from a colon: whatever threw ends its
            // message however it likes, and one that ends in no stop at all would read as a single
            // sentence with the advice that follows it.
            throw new Error(
                `This task belongs to "${runAs}", and no run can be built for that agent `
                + `(${error instanceof Error ? error.message : 'unknown error'}). `
                + 'Hand the task to somebody else, or have the user look at that agent.'
            );
        }
    }

    /** The end of the chain: it works the prompt it was handed and answers with what came of it. */
    public createSubLoop(): LoopAgent<I, O, LLM> {
        if (this.loopKind() === 'sub') {
            throw new Error('A sub loop cannot create a sub loop.');
        }
        // A helper of a run is that run: it works with the same config, which this loop was already
        // built to, so there is no class to pick here however the run came about.
        return this.spawn({
            kind: 'sub', runId: randomUUID(), assignedTask: this.assignedTask(),
            runAs: this.spawned?.runAs,
        });
    }

    private spawn(spawned: Omit<SpawnedLoop, 'permissionWhiteList'>): LoopAgent<I, O, LLM> {
        return this.newLoop(
            this.role, this.agentId, this.projectId, this.spawnedHandler(), this.asRun(spawned)
        );
    }

    /**
     * Nothing a spawned loop streams belongs to the user: it answers to the loop that spawned it,
     * and text of its own under the loop id they share would read as an answer of that loop. What
     * it has to ask and what it changed do travel on, there is nobody else to hear either.
     */
    private spawnedHandler(): AgentHandler {
        return {
            onStreamText: () => {},
            onInteractionEvent: async (event: AgentInteractionEvent) => this.askOfThisRun(event),
            onInfoEvent: (event: AgentInfoEvent) => this.agentHandler.onInfoEvent(event),
        };
    }

    /** What every loop under this one works with, whoever's model is doing the work. */
    private asRun(spawned: Omit<SpawnedLoop, 'permissionWhiteList'>): SpawnedLoop {
        return {...spawned, permissionWhiteList: this.permissionWhiteList};
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
