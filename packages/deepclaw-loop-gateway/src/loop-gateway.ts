import type {
    AgentHandler, AgentEmployee, Project, Task, AgentIdentity,
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
} from "@deepclaw/core";
import {
    getLoopId, INTERACTION_TIMEOUT, newMessage, splitLoopId, type CronTask, type CronJobHistory
} from "@deepclaw/core";
import { globalize, UpdateContent } from "@deepclaw/utils";
import {
    LoopInitializer, ProjectManager, AgentIdentityManager, LoopAgent, SkillsManager,
    type SkillInfo, SessionService, CronService,
    MCPService, RunningTaskService, ToolUseService, BackgroundCommandManager,
    type SessionSummary,
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
};

type LoopStore = Record<string, LoopState>;
export type DeepclawDataInfo = {
    agents: AgentEmployee[], projects: Project[], runningTasks: RunningTask[], busyLoops: string[],
    cronTasks: CronTask[]
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
        // TODO LRU
        const {role, agentId, projectId = ''} = splitLoopId(loopId);
        if (!this.loops[loopId]) {
            this.loops[loopId] = {
                info: {role, agentId, projectId},
                agentHandler,
                loop: this.createLoop(role, agentId, projectId, agentHandler),
                running: false
            }
        }
    }

    private static createLoop(
        role: FlushAgentRole, agentId: string, projectId: string,
        agentHandler: Partial<Omit<AgentHandler, 'onInfoEvent'>> = {}
    ) {
        return LoopInitializer.getLoop(role, agentId, projectId, {
            onStreamText: agentHandler.onStreamText || this.defaultHandler.onStreamText,
            onInteractionEvent: agentHandler.onInteractionEvent || this.defaultHandler.onInteractionEvent,
            onInfoEvent: this.defaultHandler.onInfoEvent
        });
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
        invoke().then(({text}) => {
            this.reportAnswer(loopId, source, loopState, text, onDone);
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
     */
    private static reportAnswer(
        loopId: string, source: InvokeSource, loopState: LoopState, text: string,
        onDone?: (text: string) => void
    ): void {
        try {
            onDone?.(text);
            this.updateMessage('', loopId, loopState.invoke!.msgId!, source === 'im' ? `📱 ${text}` : text);
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

    public static updateProjectTask(projectId: string, task: UpdateContent<Task>): void {
        // The board hands a task to an agent by id, and an id is anything the request cared to
        // send: a task assigned to a name nobody works under would never be worked on again.
        if (task.assignee) {
            const agent = AgentIdentityManager.getAgent(task.assignee);
            if (!agent || agent.fired) {
                throw new Error(`No agent "${task.assignee}" works here.`);
            }
        }
        ProjectManager.updateTask(projectId, task);
        this.fireSSEEvent({ eventType: 'updateProject', content: {
            id: projectId, tasks: ProjectManager.getProjectDetail(projectId).tasks
        }});
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

    private static getProjects(): Project[] {
        const res: Project[] = [];
        const projects = ProjectManager.getProjectList(true);
        projects.projects.open.concat(projects.projects.closed).forEach(p => {
            res.push(ProjectManager.getProjectDetail(p.id));
        });
        return res;
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
