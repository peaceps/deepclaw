import type {
    AgentHandler, AgentEmployee, Task, AgentIdentity,
    AgentInfoEvent,
    AgentInteractionEvent,
    ChatMessage,
    InvalidInteractionReason,
    InternalInterruptReason,
    StoppedInteractionReason,
    AgentInvokeResponse,
    TokenUsage,
    FlushAgentRole,
    SealedAgentHandler,
    RunningTask,
    SlimProject,
} from "@deepclaw/core";
import {
    getLoopId, INTERACTION_TIMEOUT, newMessage, splitLoopId, slimProject,
    slimProjectRow, type CronTask, type CronJobHistory
} from "@deepclaw/core";
import { globalize, UpdateContent } from "@deepclaw/utils";
import {
    LoopInitializer, ProjectManager, AgentIdentityManager, LoopAgent, SkillsManager,
    type SkillInfo, SessionService, CronService,
    MCPService, RunningTaskService, ToolUseService, BackgroundCommandManager,
    type SessionSummary, type CarriedLoopState,
} from "@deepclaw/agent";
import { type DeepclawConfig } from "@deepclaw/config";
import { UIChatService } from "./ui-chat-service";
import { AgentRuntimeService } from "./agent-runtime-service";
import { storeImages } from "./image-refs";
import {
    LoopInfo, InvokeSource, LoopGatewayEvent, InvokeOption,
    isAgentRuntimeStatusInfoEvent, NewSessionResult,
} from "./loop-gateway-types";
import { i18nInstance } from "@deepclaw/i18n";
import { getLogger } from "@deepclaw/node-utils";

const logger = getLogger('LoopGateway');

/**
 * How many loops are kept in memory at once. Each holds the whole of its own history, whose size
 * the compaction caps against the window of the model rather than against any figure of ours: about
 * a megabyte of heap for a common window, a few times that for the largest one, so twelve is tens
 * of megabytes.
 *
 * Twelve is well past what the thing it counts ever comes to. A loopId is `role.agentId[.projectId]`,
 * so the count is how many agent-and-project pairs have been talked in lately, and going back and
 * forth between a handful of agents over a handful of projects does not approach it. Going over
 * costs the idlest loop a cold start on its next turn, which reads its history back off the disk
 * and hands the rest over: nothing the user is shown.
 *
 * Soft, and deliberately so: a candidate the gates hold back is not evicted, so the store climbs
 * past twelve while every loop in it is busy and comes back down as they fall idle.
 */
const MAX_LIVE_LOOPS = 12;

/**
 * How many of those handovers are held for loops that have not come back. Each is a fraction of the
 * loop it came from -- a set of at most two words, a number, the paths that conversation has read --
 * but an entry only leaves as the loop it belongs to is built again, and a conversation talked in
 * once and never returned to has no such thing coming. Left uncounted, that is a store growing with
 * how long the program has been up, which is the shape of the very thing the eviction is here for.
 *
 * Twice the live limit, because what is worth keeping is what somebody comes back to, and whoever
 * waited this long has been away for two full turnovers of everything in memory. Dropping one costs
 * that conversation the permissions it was given asked for a second time: the cold start it is
 * already having, and nothing more.
 */
const MAX_CARRIED_STATES = MAX_LIVE_LOOPS * 2;

type LoopState = {
    info: LoopInfo;
    invoke?: InvokeOption & {
        msgId?: string;
        agentHandler?: Partial<Omit<SealedAgentHandler, 'onInfoEvent'>>;
    }
    agentHandler: Partial<AgentHandler>;
    loop: LoopAgent<unknown, any, any>;
    running: boolean;
    /** One per run, handed to the loop so that a stop reaches whatever the run is waiting on. */
    controller?: AbortController;
    /** When this loop was last built, opened or run: what the eviction reads to find the idlest. */
    lastUsedAt: number;
};

type LoopStore = Record<string, LoopState>;
export type DeepclawDataInfo = {
    agents: AgentEmployee[], projects: SlimProject[], runningTasks: RunningTask[],
    busyLoops: string[], cronTasks: CronTask[]
};

type InteractionResolver = {
    timer: ReturnType<typeof setTimeout> | null;
    resolve: (answer: string) => void;
    reject: (reason: string) => void;
    /**
     * The question as it stands, kept so that a view which opens while it waits can still be handed
     * it. Which browser it waits for can change: one that is gone is nobody to wait for.
     */
    question: AgentInteractionEvent;
};

class LoopGatewayImpl {
    private static cronUnsubscriber?: () => void;
    private static loops: LoopStore = {};
    /**
     * What loops the eviction let go of left for whoever builds them again, by loopId. An entry is
     * taken away as it is handed over, since a store that is never emptied is the very thing the
     * eviction above it is here to prevent, and the oldest goes once there are more of them waiting
     * than `MAX_CARRIED_STATES`, for the ones nobody ever comes back for. `startNewSession` and an
     * archived project drop theirs outright: neither has a loop coming back to take it.
     */
    private static carriedStates: Map<string, CarriedLoopState> = new Map();
    private static sseSubscribers: Set<(e: LoopGatewayEvent) => void> = new Set();
    /** By loop, since a run asks its questions one after the other, its subagents included. */
    private static waitingInteractions: Map<string, InteractionResolver> = new Map();

    public static initGateway(): void {
        if (this.cronUnsubscriber) return;
        this.cronUnsubscriber = CronService.subscribe(
            task => this.fireSSEEvent({eventType: 'updateCron', content: this.cronTaskForBrowser(task)})
        );
        MCPService.connect();
    }

    private static defaultHandler: AgentHandler = {
        onStreamText: (e) => {
            if (e.tag) return;
            this.fireSSEEvent(e)
        },
        onInteractionEvent: (e) => this.fireWaitedSSEEvent(e),
        onInfoEvent: (e) => this.fireInfoEvent(e)
    };

    /**
     * A mood is nowhere on disk, so the gateway is the one that remembers it: the run says what it
     * just felt, this folds it into the status and hands the whole of it to the browsers, which is
     * the same thing a page that loads later is given.
     */
    private static fireInfoEvent(e: AgentInfoEvent): void {
        if (isAgentRuntimeStatusInfoEvent(e)) {
            const {agentId, mood, emotion} = e.content;
            const status = AgentRuntimeService.update(agentId, mood, emotion);
            this.fireSSEEvent({...e, content: {...e.content, ...status}});
            return;
        }
        this.fireSSEEvent(e);
    }

    private static fireSSEEvent(e: LoopGatewayEvent) {
        this.sseSubscribers.forEach(cb => cb(e));
    }

    public static fireChatMessageEvent(browserId: string, loopId: string, update: boolean, message: ChatMessage): void {
        this.fireSSEEvent({eventType: 'chat', loopId, browserId, update, message})
    }

    public static fireBusyEvent(loopId: string, busy?: boolean): void {
        if (busy !== undefined && !!this.loops[loopId]) {
            this.loops[loopId]!.running = busy;
        }
        this.fireSSEEvent({ eventType: 'busy', loopId, busy: this.isLoopBusy(loopId) });
        // The busy event above only reaches whoever watches that loop, and an agent board watches none.
        this.fireSSEEvent({ eventType: 'updateBusyLoops', content: this.getBusyLoops() });
    }

    public static getBusyLoops(): string[] {
        return Object.entries(this.loops)
            .filter(([, state]) => state.running)
            .map(([loopId]) => loopId);
    }

    /**
     * A question waits for the browser it was asked of whether or not that browser has the loop on
     * screen, which is why it is kept here: a page that opens later is handed it instead of finding
     * nothing to answer. Ten minutes is where waiting ends, and then the tool call fails rather than
     * the run stopping: work is lost either way, and a subagent has no session to come back to.
     */
    private static async fireWaitedSSEEvent(e: AgentInteractionEvent): Promise<string> {
        // A run started without a browser has nobody to hear the question, and waiting ten minutes
        // ends it the same way this does. Being away for a moment and never having been there are
        // told apart here: an empty browser id is the second.
        if (!e.browserId) {
            throw 'disconnected' satisfies InvalidInteractionReason;
        }
        let resolve!: (answer: string) => void;
        let reject!: (reason: string) => void;
        const waiting = new Promise<string>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        const resolver: InteractionResolver = {timer: null, resolve, reject, question: e};
        this.waitingInteractions.set(e.loopId, resolver);
        this.fireSSEEvent(e);
        try {
            const timeout = new Promise((res) => {
                resolver.timer = setTimeout(res, INTERACTION_TIMEOUT);
            }).then(() => {
                // Whoever the question is with by the time it is over is the one told that it is.
                const question = resolver.question;
                this.fireSSEEvent({
                    eventType: 'cancelInteraction', loopId: question.loopId, browserId: question.browserId
                });
                resolver.reject('interactionAfk' satisfies InternalInterruptReason);
            });
            const result = await Promise.race([waiting, timeout]);
            return result || '';
        } finally {
            if (resolver.timer) {
                clearTimeout(resolver.timer);
            }
            // Only its own: a later question of the same loop is not this one's to clear away.
            if (this.waitingInteractions.get(e.loopId) === resolver) {
                this.waitingInteractions.delete(e.loopId);
            }
        }
    }

    public static initLoop(
        loopId: string, agentHandler: Partial<Omit<AgentHandler, 'onInfoEvent'>> = {}
    ): void {
        const {role, agentId, projectId = ''} = splitLoopId(loopId);
        const known = this.loops[loopId];
        if (known) {
            known.lastUsedAt = Date.now();
            return;
        }
        this.evictIdleLoops();
        // Handed over before it is dropped, so that an agent too broken to build keeps what it was
        // given for whichever attempt does build.
        const carried = this.carriedStates.get(loopId);
        const loop = this.createLoop(role, agentId, projectId, agentHandler, carried);
        this.carriedStates.delete(loopId);
        this.loops[loopId] = {
            info: {role, agentId, projectId},
            agentHandler,
            loop,
            running: false,
            lastUsedAt: Date.now(),
        };
    }

    /**
     * Lets go of the loops nobody is in the middle of using, until there is room for one more.
     *
     * Reclaiming memory rather than ending anything. What is dropped is an entry in this store, and
     * the conversation behind it is on disk for whoever builds the loop next to read back -- the
     * same rebuild `isOutdated` has been doing all along. What was only ever in memory is set aside
     * here and handed to that one, so a user returning to an evicted loop is not asked again for
     * permissions they already gave, nor is the loop guessing at a token count it once knew.
     *
     * Three gates, each of them a way of saying somebody is still holding the loop: a run going, a
     * run begun and not yet cleared, a question waiting on its answer. A loop held back is kept even
     * where it is the idlest there is, which is what makes the limit a soft one.
     *
     * Nothing here touches the session folder, and that is what tells this apart from
     * `startNewSession`, which has to refuse while a background command is still writing into the
     * folder it moves. A command outlives the loop that started it either way -- it sits in a store
     * of its own under the same loopId -- so the loop built next drains the result all the same.
     */
    private static evictIdleLoops(): void {
        const idlestFirst = Object.entries(this.loops)
            .sort(([, one], [, other]) => one.lastUsedAt - other.lastUsedAt);
        let live = idlestFirst.length;
        for (const [loopId, loopState] of idlestFirst) {
            if (live < MAX_LIVE_LOOPS) {
                return;
            }
            if (loopState.running || loopState.invoke || this.waitingInteractions.has(loopId)) {
                continue;
            }
            this.carryState(loopId, loopState.loop.carriedState());
            delete this.loops[loopId];
            live -= 1;
        }
    }

    /**
     * Holds what a loop left behind for the one built in its place, and lets go of the longest
     * waiting where too many are waiting at once.
     *
     * The oldest is the first the map holds: an entry is always taken away as it is handed over, so
     * every one of these was put here by the eviction that made it, in the order the evictions
     * happened.
     */
    private static carryState(loopId: string, carried: CarriedLoopState): void {
        this.carriedStates.set(loopId, carried);
        for (const oldest of this.carriedStates.keys()) {
            if (this.carriedStates.size <= MAX_CARRIED_STATES) {
                return;
            }
            this.carriedStates.delete(oldest);
        }
    }

    private static createLoop(
        role: FlushAgentRole, agentId: string, projectId: string,
        agentHandler: Partial<Omit<AgentHandler, 'onInfoEvent'>> = {},
        carried?: CarriedLoopState
    ) {
        return LoopInitializer.getLoop(role, agentId, projectId, {
            onStreamText: agentHandler.onStreamText || this.defaultHandler.onStreamText,
            onInteractionEvent: agentHandler.onInteractionEvent || this.defaultHandler.onInteractionEvent,
            onInfoEvent: this.defaultHandler.onInfoEvent
        }, carried);
    }

    public static isLoopBusy(loopId: string): boolean {
        return this.loops[loopId]?.running ?? false;
    }

    /**
     * Closes the conversation of this loop and leaves an empty one in its place. The folder is moved
     * aside on disk, and the loop that was holding that history in memory is built again: without
     * that the next turn would go on answering out of a conversation the user has already closed.
     *
     * Refused while a run is going, and refused while a background command is still writing into
     * the session folder, which is a thing that outlives the run that started it.
     */
    public static startNewSession(loopId: string): NewSessionResult {
        const {role, agentId, projectId = ''} = splitLoopId(loopId);
        // A cron session lives in the temp folder and is thrown away after every run, so there is
        // no conversation there to close and nothing that would be kept by archiving it.
        if (role === 'cron') {
            return {started: false, reason: 'unsupported'};
        }
        if (this.isLoopBusy(loopId)) {
            return {started: false, reason: 'busy'};
        }
        if (BackgroundCommandManager.hasRunningCommand(loopId)) {
            return {started: false, reason: 'backgroundCommand'};
        }
        // Everything after this point is said on the strength of the folder having moved. A failure
        // read as a conversation closed would empty the chat and build the loop again, and the loop
        // would read the same history back off the disk it never left: the user would be told they
        // are starting over while the agent went on remembering all of it.
        let sessionId: string | undefined;
        try {
            UIChatService.migrateLegacyChatFile(loopId);
            sessionId = SessionService.archiveSession(loopId);
        } catch (error) {
            logger.error(`Failed to archive the conversation of ${loopId}: ${error}`);
            return {started: false, reason: 'archiveFailed'};
        }
        // Past here the conversation is closed and there is nothing left to refuse: the folder has
        // moved. A loop that cannot be built again is dropped instead, for the next turn to build
        // lazily and fail there if the agent is still broken. Keeping the one that is holding the
        // closed conversation would be keeping an agent that answers out of it.
        UIChatService.forget(loopId);
        // A new conversation is not the one anything was allowed in, so whatever an eviction set
        // aside for this loop goes with the old one. The rebuild below is given nothing either.
        this.carriedStates.delete(loopId);
        const loopState = this.loops[loopId];
        if (loopState) {
            try {
                loopState.loop = this.createLoop(role, agentId, projectId, loopState.agentHandler);
            } catch (error) {
                logger.error(`Failed to build ${loopId} again after closing its conversation: ${error}`);
                delete this.loops[loopId];
            }
        }
        this.fireSSEEvent({eventType: 'sessionReset', loopId});
        return {started: true, sessionId};
    }

    /** The conversations of this loop that were closed, for a view that lists them to be read back. */
    public static listSessions(loopId: string): SessionSummary[] {
        return SessionService.listSessions(loopId);
    }

    /**
     * A page of a conversation that was closed, read back from the end the same way the live one is.
     *
     * Which conversation has to be said outright. An empty name reads as the one being talked in
     * everywhere below here, which would walk past the check on the name and hand back the live
     * chat under the guise of an archived one, holding on to it afterwards as if it were live.
     */
    public static getSessionMessages(
        loopId: string, sessionId: string, endMessageId?: string
    ): ChatMessage[] {
        if (!sessionId) {
            throw new Error(`No session was named to read back from ${loopId}.`);
        }
        return UIChatService.getOlderMessages(loopId, endMessageId, sessionId);
    }

    /**
     * Sets a run going and answers at once with the message it will be written into. The run comes
     * back later through `onDone`, worded for whoever asked for it: a caller that was streamed the
     * run as it happened is handed all of it, one that watched none of it the answer alone. Which
     * of the two is read off the source, in `reportAnswer`.
     */
    public static invoke(
        loopInfo: LoopInfo, options: InvokeOption, input: string,
        agentHandler?: Partial<Omit<SealedAgentHandler, 'onInfoEvent'>>,
        onDone?: (text: string) => void,
    ): {busy: boolean, msgId: string} {
        const {role, agentId, projectId = ''} = loopInfo;
        const {browserId = '', source} = options;
        const loopId = getLoopId(role, agentId, projectId);
        const images = storeImages(loopId, options.images);
        if (!this.loops[loopId]) {
            this.initLoop(loopId);
        } else {
            const loopState = this.loops[loopId]!;
            if (loopState.loop.isOutdated()) {
                loopState.loop = this.createLoop(
                    role, agentId, projectId, loopState.agentHandler
                );
            }
        }
        const loopState = this.loops[loopId]!;
        loopState.lastUsedAt = Date.now();
        const agentMessages = newMessage('agent', agentId, '');
        this.addMessage('', loopId, agentMessages);
        if (this.isLoopBusy(loopId)) {
            this.updateMessage('', loopId, agentMessages.id, i18nInstance.t('gateway.busy'));
            return {busy: true, msgId: agentMessages.id};
        }
        loopState.running = true;
        loopState.invoke = {
            browserId,
            source,
            agentHandler,
            msgId: agentMessages.id
        };
        const controller = new AbortController();
        loopState.controller = controller;
        this.fireBusyEvent(loopId);
        this.invokeAndReturn(
            loopId, source, loopState,
            () => loopState.loop.invoke(input, {
                browserId, images, agentHandler, abortSignal: controller.signal
            }),
            onDone
        );
        return {busy: false, msgId: agentMessages.id};
    }

    /**
     * Ends the run of this loop at the first place it can be ended, and answers whether there was
     * one to end. Three things have to happen and none of them stands for the others: the signal
     * cuts short whatever the run is waiting on, the reason is what turns that into an ending the
     * loop words rather than an error it reports, and a question already on somebody's screen has
     * to be taken back or the run would sit in it for the ten minutes it is allowed.
     *
     * Whoever asks may be any browser, including one that started nothing. The lock this releases
     * is held against every browser watching the loop, so leaving it to the one that started the
     * run would hold the rest hostage to a tab that may well be closed by now: a browser id lives
     * in a tab and dies with it, and a run started from IM is under an id no browser ever held.
     */
    public static stop(loopId: string): boolean {
        const loopState = this.loops[loopId];
        if (!loopState?.running) {
            return false;
        }
        loopState.controller?.abort();
        loopState.loop.setExternalInterruptReason('userStopped');
        this.dropWaitingInteraction(loopId);
        return true;
    }

    /**
     * Takes back the question this loop is waiting on, if it waits on one.
     *
     * The promise is really rejected rather than raced against the signal: the waiting one is what
     * clears the ten minute timer and forgets the resolver in its finally, and a promise left
     * unsettled leaks both. The event that closes the dialog goes to the browser holding the
     * question rather than the one that pressed stop, and is read fresh: a question outlives the
     * tab it was put to and is handed to whichever browser asked for it since. Sent under the
     * wrong id it matches no dialog, and the one that is open never closes while the run behind
     * it is already over.
     *
     * A user answering in the very same moment is no problem: their resolve came first, the reject
     * below does nothing, and the tool call runs on to be stopped at the next place that looks.
     */
    private static dropWaitingInteraction(loopId: string): void {
        const resolver = this.waitingInteractions.get(loopId);
        if (!resolver) {
            return;
        }
        const question = resolver.question;
        this.fireSSEEvent({
            eventType: 'cancelInteraction', loopId: question.loopId, browserId: question.browserId
        });
        resolver.reject('userStopped' satisfies StoppedInteractionReason);
    }

    private static invokeAndReturn(
        loopId: string, source: InvokeSource, loopState: LoopState,
        invoke: () => Promise<AgentInvokeResponse>,
        onDone?: (text: string) => void
    ): void {
        invoke().then((answer) => {
            this.reportAnswer(loopId, source, loopState, answer, onDone);
        // Unreachable, and kept as the last line of defence rather than as a path with behaviour
        // of its own. A loop wraps its whole run and answers with the error instead of throwing
        // it, FlushAgent.invoke wraps that again, and what it answers with is a promise that only
        // ever resolves; the success side above is sealed so that it cannot land here either.
        // Nothing of the run belongs in this branch: a chat message written from it would be one
        // no reachable code can produce.
        }).catch((error) => {
            logger.warn(`invokeAndReturn failed: ${error}`);
            onDone?.(error?.message || error);
        }).finally(() => {
            this.clearLoopState(loopState);
            this.fireBusyEvent(loopId);
        });
    }

    /**
     * Handing the answer out and writing it down, in a shape where none of it can fail the run.
     * A chat file may refuse the write and the usage figures may not be there, and neither is
     * worth telling the caller about: the answer itself already went out. Left to throw, any of
     * these would land in the catch above, which calls onDone again with the error — an IM user
     * would read the answer and then, underneath it, be told the turn failed.
     *
     * Which of the two the run is given as comes down to whether the reader watched it happen, and
     * that is asked once here for both the chat and whoever is waiting on the call. Somebody who
     * read the run as it came holds every word of it already: written short, the message would
     * change under the eyes reading it and change back on the next reload, and a screen the run was
     * printed on would end up with the last line of it standing for the whole. A reply carried to IM
     * is read by somebody who watched none of it, and there the answer is what they asked for; the
     * copy of it left in the chat is that same reply, being what that reader was already sent. Asked
     * twice, the file and the screen of one conversation come to say different things — which is
     * what a terminal reading it the way IM does looked like.
     *
     * A run that answered with nothing leaves the message it was opened with exactly as it was,
     * and an empty message is how a run still thinking is drawn: a run over and a run thinking read
     * the same. Left standing, as it has always stood — writing nothing over nothing changes none
     * of it, and what such a run should say instead is a sentence nobody has written yet.
     */
    private static reportAnswer(
        loopId: string, source: InvokeSource, loopState: LoopState, answer: AgentInvokeResponse,
        onDone?: (text: string) => void
    ): void {
        try {
            const {text, said} = answer;
            const watched = source !== 'im';
            onDone?.(watched ? said : text);
            this.updateMessage('', loopId, loopState.invoke!.msgId!, watched ? said : `📱 ${text}`);
            const usage = SessionService.getTokenUsage(loopId);
            if (usage) {
                this.fireSSEEvent({eventType: 'tokenUsage', loopId, usage});
            }
        } catch (error) {
            logger.warn(`Failed to hand out the answer of ${loopId}: ${error}`);
        }
    }

    private static clearLoopState(loopState: LoopState): void {
        loopState.running = false;
        loopState.invoke = undefined;
        loopState.controller = undefined;
    }

    public static addMessage(
        fromBrowserId: string, loopId: string, message: ChatMessage
    ): void {
        UIChatService.addMessage(loopId, message);
        this.fireChatMessageEvent(fromBrowserId, loopId, false, message);
    }

    public static updateMessage(fromBrowserId: string, loopId: string, id: string, text: string): void {
        const message = UIChatService.replaceMessage(loopId, id, text);
        if (message) {
            this.fireChatMessageEvent(fromBrowserId, loopId, true, message);
        }
    }

    public static updateConfig(config: DeepclawConfig) {
        for (const agentConfig of config.agents) {
            for (const loopId of Object.keys(this.loops)) {
                const {agentId} = splitLoopId(loopId);
                if (agentId === agentConfig.id) {
                    this.loops[loopId]!.loop.updateAgentConfig(agentConfig);
                }
            }
        }
        MCPService.connect();
    }

    public static subscribe(cb: (e: LoopGatewayEvent) => void): () => void {
        this.sseSubscribers.add(cb);
        return () => this.sseSubscribers.delete(cb);
    }

    public static newAgentIdentity(id: string): AgentEmployee {
        const identity = AgentIdentityManager.newAgentIdentity(id);
        const newAgent = {
            ...identity,
            ...AgentRuntimeService.getStatus(id),
        };
        this.fireSSEEvent({ eventType: 'updateAgent', content: newAgent });
        return newAgent;
    }

    public static updateAgentIdentity(identity: UpdateContent<AgentIdentity>): void {
        AgentIdentityManager.updateAgentIdentity(identity);
        this.fireSSEEvent({ eventType: 'updateAgent', content: identity });
    }

    public static updateProjectTags(projectId: string, tags: string[]): void {
        ProjectManager.updateProject({id: projectId, tags});
        this.fireSSEEvent({ eventType: 'updateProject', content: { id: projectId, tags } });
    }

    public static updateProjectDescription(projectId: string, description: string): void {
        const project = ProjectManager.updateProject({id: projectId, description});
        // What was written rather than what came in: a long one is cut where it is written down,
        // and a browser handed the words it sent would show a description the disk has not got.
        this.fireSSEEvent({
            eventType: 'updateProject', content: {id: projectId, description: project.description}
        });
    }

    /**
     * The user setting the work of a project going, and every browser told the moment it is written:
     * a project starts once and the button for it goes with the start, so a second tab showing that
     * button on a project already under way is the one thing that has to be put right at once.
     *
     * The date is all this writes. Whoever pressed it starts the run of that project itself, the
     * same way a message sent to it does, so that one path leads into a project run and not two: the
     * word the agent is given, and the message of it the user reads back, are the same word.
     */
    public static startProject(projectId: string): void {
        const project = ProjectManager.startProject(projectId);
        this.fireSSEEvent({
            eventType: 'updateProject', content: {id: projectId, startedAt: project.startedAt}
        });
    }

    /**
     * Puts a project away at the user's word, and says so to every browser: the row goes, here as
     * on the tab that asked.
     *
     * Refused while the session of that project is running: the project leaves the manager, and the
     * run that comes back to mark a task done would find nothing to mark. What is asked is whether a
     * loop of this project is at work, not whether anything anywhere is touching it -- a scheduled
     * run, or a chat of an agent that belongs to no project, reaches a project by the id it was given
     * and none of those show up here. Those are left to fail on their next write, as a tool error the
     * model is told about and the run carries on from, which is a cheaper thing to allow than keeping
     * a note of every project every loop has touched. The button is disabled while the session runs,
     * so this is for the click that got in first rather than for the user to read.
     */
    public static archiveProject(projectId: string): void {
        if (this.getBusyLoops().some(loopId => splitLoopId(loopId).projectId === projectId)) {
            throw new Error(`Project ${projectId} has a run going.`);
        }
        const project = ProjectManager.archiveProject(projectId);
        // Past here the folder has moved, so every conversation of that project is one written where
        // nothing is any more, and is let go of rather than kept: a chat that stayed would count the
        // messages it had already written and put the next one in the middle of a file that is gone,
        // and a loop that stayed would be an agent answering out of a project nobody has. Nothing is
        // rebuilt in their place -- there is no project left to build one for -- and it is by the
        // project rather than by one loop, since more than one agent may have been talking about it.
        UIChatService.forgetProject(projectId);
        for (const loopId of Object.keys(this.loops)) {
            if (splitLoopId(loopId).projectId === projectId) {
                delete this.loops[loopId];
            }
        }
        // Including what an eviction set aside for a loop of this project, which is waiting for a
        // rebuild that is never coming.
        for (const loopId of this.carriedStates.keys()) {
            if (splitLoopId(loopId).projectId === projectId) {
                this.carriedStates.delete(loopId);
            }
        }
        this.fireSSEEvent({
            eventType: 'updateProject', content: {id: projectId, archivedAt: project.archivedAt}
        });
    }

    public static updateProjectTask(projectId: string, task: UpdateContent<Task>): void {
        // The board hands a task to an agent by id, and an id is anything the request cared to
        // send: a task assigned to a name nobody works under would never be worked on again.
        if (task.assignee) {
            const agent = AgentIdentityManager.getAgent(task.assignee);
            if (!agent || agent.fired) {
                throw new Error(`No agent "${task.assignee}" works here.`);
            }
        }
        if (task.status) {
            this.refuseWhileWorked(projectId, task.id);
        }
        ProjectManager.updateTask(projectId, task);
        this.announceProject(projectId);
    }

    /**
     * The user taking a task up themselves, which the board offers on a card in todo. Two writes --
     * the project started where it was not, and the task ongoing -- since work under way on a
     * project with no start date on it is work every later task of that project is refused by.
     *
     * The date is written from this side of the wall: asked of the service where the task is written
     * instead, it would be a date a run could write for itself -- mark a task ongoing, and the gate
     * the start button holds shut is open. Which leaves the two writes to be ordered by hand, and
     * the date going first, because the service refuses a task leaving todo until it is there.
     *
     * So everything that could refuse this is asked before the date goes down. A task refused after
     * it was written would leave a project started on the strength of an edit that never happened,
     * and started is for good. Nothing but the status is sent on, no patch riding along with it,
     * which is what makes the refusals countable: a task in todo taking ongoing and nothing else,
     * on a project that is now started, is a call the service has nothing left to turn away.
     */
    public static takeUpProjectTask(projectId: string, taskId: string): void {
        // A task is claimed for a subagent before the status is written -- the claim is what keeps
        // two calls of one turn off the same task, and building a loop is an await -- so the status
        // alone would let a click through in that window, on work already handed out. What the user
        // is owed there is being told a subagent has it, not a status they think they wrote.
        this.refuseWhileWorked(projectId, taskId);
        const task = ProjectManager.getTask(projectId, taskId);
        if (!task) {
            throw new Error('Task not found.');
        }
        if (task.status !== 'todo') {
            throw new Error('Only a task still in todo can be taken up.');
        }
        ProjectManager.startProject(projectId);
        ProjectManager.updateTask(projectId, {id: taskId, status: 'ongoing'});
        this.announceProject(projectId);
    }

    /**
     * The user closing a task off from the board, which is the steps of it as well as its status and
     * so is asked for as the one thing it is rather than sent as a patch.
     */
    public static finishProjectTask(projectId: string, taskId: string): void {
        this.refuseWhileWorked(projectId, taskId);
        ProjectManager.finishTask(projectId, taskId);
        this.announceProject(projectId);
    }

    /**
     * Where a subagent is on the task, its status is nobody else's to move. The run is asked rather
     * than the record, the record saying only that the task was handed out: a task closed under a
     * subagent still at work is a task every write of that run is refused by, and it would spend
     * what turns it has left on a task nothing can be reported about any more.
     *
     * Which is the two doors above, those being where a status is written from now. The patch door
     * asks it of a status all the same, for a caller that sends one there, but the board no longer
     * has a way to: what a card may write does not include the word. The words of a task are
     * another matter and are left alone by all of them -- those are read by whoever picks the work
     * up, and a title put right while the work runs is the point of putting it right.
     */
    private static refuseWhileWorked(projectId: string, taskId: string): void {
        if (RunningTaskService.isRunning(projectId, taskId)) {
            throw new Error('A subagent is working on this task. Wait for it to report back.');
        }
    }

    /**
     * The whole project rather than its tasks alone: how many there are is read off a row that holds
     * none of them, and tasks arriving without it would leave that count saying what it said before
     * the edit.
     */
    private static announceProject(projectId: string): void {
        this.fireSSEEvent({
            eventType: 'updateProject',
            content: slimProject(ProjectManager.getProjectDetail(projectId)),
        });
    }

    /** From the browser the question is with, and from no other: the rest are onlookers. */
    public static resolveInteraction(browserId: string, loopId: string, answer: string): boolean {
        const resolver = this.waitingInteractions.get(loopId);
        if (resolver?.question.browserId !== browserId) {
            return false;
        }
        resolver.resolve(answer);
        return true;
    }

    /** What this browser still owes an answer to, for a view that opened after the question was asked. */
    public static pendingInteraction(browserId: string, loopId: string): AgentInteractionEvent | undefined {
        const question = this.waitingInteractions.get(loopId)?.question;
        return question?.browserId === browserId ? question : undefined;
    }

    /** Every question that waits for an answer, each with the browser it is waiting for. */
    public static waitingQuestions(): AgentInteractionEvent[] {
        return [...this.waitingInteractions.values()].map(resolver => resolver.question);
    }

    /**
     * Puts the question of this loop to another browser. A question belongs to the loop rather than
     * to the tab that happened to start the run, and the browser it was asked of may well be gone
     * for good: its name lived in a tab. Whoever it is put to is then the only one it takes an
     * answer from. Whether the one it was asked of is really gone is not for the gateway to say.
     */
    public static askAgainOf(browserId: string, loopId: string): AgentInteractionEvent | undefined {
        const resolver = this.waitingInteractions.get(loopId);
        if (!resolver) {
            return undefined;
        }
        resolver.question = {...resolver.question, browserId};
        return resolver.question;
    }

    /**
     * Which browser the run of this loop puts its questions to, if it puts them to one at all: a run
     * started from a chat asks there, and a page is not who its silence is about.
     */
    public static askedBrowser(loopId: string): string | undefined {
        const invoke = this.loops[loopId]?.invoke;
        return invoke?.source === 'web' ? invoke.browserId : undefined;
    }

    /**
     * A run that had given up on asking goes back to asking: the silence it found was the user being
     * elsewhere, and somebody is there now. Who counts as there is decided by whoever knows the
     * streams, since ten more minutes of the same silence is what a wrong answer to that costs.
     */
    public static askAgain(loopId: string): void {
        ToolUseService.clearAwayUser(loopId);
    }

    public static cancelInteraction(
        browserId: string, loopId: string, reason: InvalidInteractionReason | InternalInterruptReason
    ): void {
        const resolver = this.waitingInteractions.get(loopId);
        if (resolver?.question.browserId === browserId) {
            resolver.reject(reason);
        }
    }

    public static getSkills(): SkillInfo[] {
        return SkillsManager.getSkillList();
    }

    public static setSkillAgents(name: string, agentIds?: string[]): void {
        SkillsManager.updateSkillAgents(name, agentIds);
    }

    public static removeSkill(name: string): boolean {
        return SkillsManager.removeSkill(name);
    }

    public static getCronTasks(): CronTask[] {
        return CronService.getCronTasks().map(task => this.cronTaskForBrowser(task));
    }

    public static getCronHistories(id: string, beforeStart: number, limit?: number): CronJobHistory[] {
        return CronService.getCronHistories(id, beforeStart, limit)
            .map(history => this.historyForBrowser(history));
    }

    public static updateCronTaskStatus(id: string, pause?: boolean, close?: boolean): void {
        CronService.updateCronTaskStatus({id, pause, close});
    }

    /**
     * A task on its way to a browser, with what no browser reads left out.
     *
     * Done here rather than where the runs are recorded because `finalText` is not dead weight
     * everywhere: it is the report itself, and the tool a run reads its own past with is served the
     * same records by the same service. This is the boundary the browser is on, and the only one
     * where leaving it out is safe.
     */
    private static cronTaskForBrowser<T extends {histories?: CronJobHistory[] | null}>(task: T): T {
        return task.histories
            ? {...task, histories: task.histories.map(history => this.historyForBrowser(history))}
            : task;
    }

    /**
     * One run of a task as a browser gets it: the report it wrote is not sent.
     *
     * Nothing in the web app reads it -- a run is shown by its output and its usage -- and it is the
     * largest field a record has, a run that reported at length carrying kilobytes of prose that go
     * over the wire on every push and every page. What wants it is the model, through its own tool,
     * and that path does not come through here.
     */
    private static historyForBrowser(history: CronJobHistory): CronJobHistory {
        // Everything but the one field, rather than a list of the fields to keep: a field added
        // later reaches the browser on its own, and forgetting to add it here would be the quieter
        // mistake.
        const forBrowser = {...history};
        delete forBrowser.finalText;
        return forBrowser;
    }

    public static getDataInfo(): DeepclawDataInfo {
        const projects = this.getProjects();
        return {
            agents: this.getAgents(),
            projects,
            // A page that just loaded has seen none of the events, so the work travels with it.
            runningTasks: RunningTaskService.getRunningTasks(),
            busyLoops: this.getBusyLoops(),
            cronTasks: this.getCronTasks(),
        };
    }

    /**
     * Every project, as a row of the board rather than whole: the tasks stay here until a row is
     * opened and asks for them. This is the one part of what a page is handed that grows with how
     * many projects there are, and the tasks are almost all of a project by weight.
     */
    private static getProjects(): SlimProject[] {
        const res: SlimProject[] = [];
        const projects = ProjectManager.getProjectList(true);
        projects.projects.open.concat(projects.projects.closed).forEach(p => {
            res.push(slimProjectRow(ProjectManager.getProjectDetail(p.id)));
        });
        return res;
    }

    /** The whole of one project, for the row that just opened on it. */
    public static getProjectDetail(projectId: string): SlimProject {
        return slimProject(ProjectManager.getProjectDetail(projectId));
    }

    /** The moods and the emotions come along: a tab that connects later sees what the others saw. */
    private static getAgents(): AgentEmployee[] {
        return AgentIdentityManager.getAgents().map(agent => {
            return {
                ...agent,
                ...AgentRuntimeService.getStatus(agent.id),
            }
        });
    }

    public static getTokenUsage(loopId: string): TokenUsage | undefined {
        return SessionService.getTokenUsage(loopId);
    }
}

export const LoopGateway = globalize('LoopGateway', LoopGatewayImpl);
