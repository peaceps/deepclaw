import type {
    AgentHandler, AgentEmployee, Project, Task, AgentIdentity,
    AgentInteractionEvent,
    ChatMessage,
    InvalidInteractionReason,
    InternalInterruptReason,
    AgentRuntime,
    AgentInvokeResponse,
    TokenUsage,
    FlushAgentRole,
    SealedAgentHandler,
} from "@deepclaw/core";
import {
    getLoopId, isInternalInterruptReason, newMessage, splitLoopId, type CronTask, type CronJobHistory
} from "@deepclaw/core";
import { globalize, UpdateContent } from "@deepclaw/utils";
import {
    LoopInitializer, ProjectManager, AgentIdentityManager, LoopAgent, SkillsManager,
    type SkillInfo, SessionService, CronService,
    MCPService,
} from "@deepclaw/agent";
import { type DeepclawConfig } from "@deepclaw/config";
import { UIChatService } from "./ui-chat-service";
import { storeImages } from "./image-refs";
import { LoopInfo, InvokeSource, LoopGatewayEvent, getClientKey, InvokeOption } from "./loop-gateway-types";
import { i18nInstance } from "@deepclaw/i18n";
import { getLogger } from "@deepclaw/node-utils";

const logger = getLogger('LoopGateway');

type LoopState = {
    info: LoopInfo;
    invoke?: InvokeOption & {
        msgId?: string;
        agentHandler?: Partial<Omit<SealedAgentHandler, 'onInfoEvent'>>;
        runtime?: AgentRuntime;
    }
    agentHandler: Partial<AgentHandler>;
    loop: LoopAgent<unknown, any, any>;
    running: boolean;
};
type LoopStore = Record<string, LoopState>;
export type DeepclawDataInfo = {agents: AgentEmployee[], projects: Project[]};

const INTERACTION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

type InteractionResolver = {
    timer: ReturnType<typeof setTimeout> | null;
    resolve: (answer: string) => void;
    reject: (reason: string) => void;
};

class LoopGatewayImpl {
    private static cronUnsubscriber?: () => void;
    private static loops: LoopStore = {};
    private static sseSubscribers: Set<(e: LoopGatewayEvent) => void> = new Set();
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
        onInfoEvent: (e) => this.fireSSEEvent(e)
    };

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
    }

    private static async fireWaitedSSEEvent(e: AgentInteractionEvent): Promise<string> {
        const clientKey = getClientKey(e.browserId, e.loopId);
        const waiting = new Promise<string>((resolve, reject) => this.waitingInteractions.set(
            clientKey, {timer: null, resolve, reject}
        ));
        this.fireSSEEvent(e);
        try {
            const timeout = new Promise((res) => {
                const timer = setTimeout(res, INTERACTION_TIMEOUT);
                this.waitingInteractions.get(clientKey)!.timer = timer;
            }).then(() => {
                this.fireSSEEvent({ eventType: 'cancelInteraction', loopId: e.loopId, browserId: e.browserId });
                this.cancelInteraction(e.browserId, e.loopId, 'timeout');
            });
            const result = await Promise.race([waiting, timeout]);
            return result || '';
        } finally {
            const timer = this.waitingInteractions.get(clientKey)?.timer;
            if (timer) {
                clearTimeout(timer);
            }
            this.waitingInteractions.delete(clientKey);
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
        const images = storeImages(options.images);
        const loopId = getLoopId(role, agentId, projectId);
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

    public static resume(
        browserId: string, source: InvokeSource, loopId: string,
        onDone?: (text: string) => void,
    ): {resume: boolean, msgId: string} {
        if (!this.loops[loopId]) {
            return {resume: false, msgId: ''};
        }
        const loopState = this.loops[loopId]!;
        if (loopState.invoke?.browserId !== browserId || !loopState.invoke?.runtime) {
            return {resume: false, msgId: ''};
        }
        if (loopState.loop.isOutdated()) {
            loopState.loop = this.createLoop(
                loopState.info.role, loopState.info.agentId,
                loopState.info.projectId || '', loopState.agentHandler
            );
        }
        const runtime = loopState.invoke.runtime!
        loopState.invoke.runtime = undefined;
        this.invokeAndReturn(
            loopId, source, loopState,
            () => loopState.loop.resume({
                browserId, agentHandler: loopState.invoke!.agentHandler, runtime
            }),
            onDone
        );
        return {resume: true, msgId: loopState.invoke.msgId!};
    }

    private static invokeAndReturn(
        loopId: string, source: InvokeSource, loopState: LoopState,
        invoke: () => Promise<AgentInvokeResponse>,
        onDone?: (text: string) => void
    ): void {
        invoke().then(({text, runtime}) => {
            const state = runtime.agentBreakReason;
            if (!isInternalInterruptReason(state)) {
                onDone?.(text);
                this.updateMessage('', loopId, loopState.invoke!.msgId!, source === 'im' ? `📱 ${text}` : text);
                const usage = SessionService.getTokenUsage(loopId);
                if (usage) {
                    this.fireSSEEvent({eventType: 'tokenUsage', loopId, usage});
                }
                this.clearLoopState(loopState);
            } else {
                loopState.invoke!.runtime = runtime;
                loopState.invoke!.runtime.agentBreakReason = undefined;
            }
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

    public static disconnectBrowser(browserId: string) {
        for (const loopId of Object.keys(this.loops)) {
            const loopState = this.loops[loopId];
            if (loopState && loopState.running && loopState.invoke?.browserId === browserId) {
                loopState.loop.setExternalInterruptReason('clientLost');
                this.cancelInteraction(browserId, loopId, 'disconnected');
                if (loopState.invoke?.runtime) {
                    this.resume(browserId, loopState.invoke.source, loopId);
                }
            }
        }
    }

    public static newAgentIdentity(id: string): AgentEmployee {
        const identity = AgentIdentityManager.newAgentIdentity(id);
        const newAgent = {
            ...identity,
            mood: 'none' as const,
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

    public static updateProjectTask(projectId: string, task: UpdateContent<Task, 'title'>): void {
        ProjectManager.updateTask(projectId, task);
        this.fireSSEEvent({ eventType: 'updateProject', content: {
            id: projectId, tasks: ProjectManager.getProjectDetail(projectId).tasks
        }});
    }

    public static resolveInteraction(browserId: string, loopId: string, answer: string): boolean {
        const interactionId = getClientKey(browserId, loopId);
        const resolver = this.waitingInteractions.get(interactionId);
        if (resolver) {
            resolver.resolve(answer);
            return true;
        }
        return false;
    }

    public static cancelInteraction(
        browserId: string, loopId: string, reason: InvalidInteractionReason | InternalInterruptReason
    ): void {
        const interactionId = getClientKey(browserId, loopId);
        const resolver = this.waitingInteractions.get(interactionId);
        if (resolver) {
            resolver.reject(reason);
        }
    }

    public static getSkills(): SkillInfo[] {
        return SkillsManager.getSkillList();
    }

    public static setSkillAgents(name: string, agentIds?: string[]): void {
        SkillsManager.updateSkillAgents(name, agentIds);
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

    private static getAgents(): AgentEmployee[] {
        return AgentIdentityManager.getAgents().map(agent => {
            return {
                ...agent,
                mood: 'none',
            }
        });
    }

    public static getTokenUsage(loopId: string): TokenUsage | undefined {
        return SessionService.getTokenUsage(loopId);
    }
}

export const LoopGateway = globalize('LoopGateway', LoopGatewayImpl);
