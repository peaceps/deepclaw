import type {
    AgentHandler, AgentEmployee, Project, Task, AgentIdentity,
    AgentInfoEvent,
    AgentInteractionEvent,
    ChatMessage,
    InvalidInteractionReason,
    InternalInterruptReason,
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
    MCPService, RunningTaskService, ToolUseService,
} from "@deepclaw/agent";
import { type DeepclawConfig } from "@deepclaw/config";
import { UIChatService } from "./ui-chat-service";
import { AgentRuntimeService } from "./agent-runtime-service";
import { storeImages } from "./image-refs";
import {
    LoopInfo, InvokeSource, LoopGatewayEvent, InvokeOption,
    isAgentRuntimeStatusInfoEvent,
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
        this.cronUnsubscriber = CronService.subscribe(task => this.fireSSEEvent({eventType: 'updateCron', content: task}));
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
        this.fireBusyEvent(loopId);
        this.invokeAndReturn(
            loopId, source, loopState,
            () => loopState.loop.invoke(input, {browserId, images, agentHandler}),
            onDone
        );
        return {busy: false, msgId: agentMessages.id};
    }

    private static invokeAndReturn(
        loopId: string, source: InvokeSource, loopState: LoopState,
        invoke: () => Promise<AgentInvokeResponse>,
        onDone?: (text: string) => void
    ): void {
        invoke().then(({text}) => {
            onDone?.(text);
            this.updateMessage('', loopId, loopState.invoke!.msgId!, source === 'im' ? `📱 ${text}` : text);
            const usage = SessionService.getTokenUsage(loopId);
            if (usage) {
                this.fireSSEEvent({eventType: 'tokenUsage', loopId, usage});
            }
            this.clearLoopState(loopState);
        }).catch((e) => {
            logger.warn(`invokeAndReturn failed: ${e}`);
            onDone?.(e?.message || e);
            this.clearLoopState(loopState);
        }).finally(() => {
            this.fireBusyEvent(loopId);
        });
    }

    private static clearLoopState(loopState: LoopState): void {
        loopState.running = false;
        loopState.invoke = undefined;
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
        return CronService.getCronTasks();
    }

    public static getCronHistories(id: string, beforeStart: number, limit?: number): CronJobHistory[] {
        return CronService.getCronHistories(id, beforeStart, limit);
    }

    public static updateCronTaskStatus(id: string, pause?: boolean, close?: boolean): void {
        CronService.updateCronTaskStatus({id, pause, close});
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
