import type {
    AgentHandler, AgentEmployee, Project, AgentEvent, Task, AgentIdentity,
    AgentInteractionEvent,
    AgentInfoEvent,
    ChatMessage,
    InvalidInteractionReason,
    PauseInLoopReason,
    AgentRuntime,
    AgentInvokeResponse
} from "@deepclaw/core";
import {
    getFlushAgentKey, getInteractionId, isExternalStopReason, isPauseInLoopReason, newMessage, splitFlushAgentKey
} from "@deepclaw/core";
import { DistributiveOmit, globalize } from "@deepclaw/utils";
import {
    LoopInitializer, ProjectManager, AgentIdentityManager, LoopAgent
} from "@deepclaw/agent";
import { type DeepclawConfig } from "@deepclaw/config";
import { UIChatService } from "./ui-chat-service";

type LoopState = {
    agentId: string;
    projectId: string;
    loop: LoopAgent<unknown, any, any>;
    running: boolean;
    browserId?: string;
    runtime?: AgentRuntime;
};
type LoopStore = Record<string, LoopState>;
export type LoopInfo = {agents: AgentEmployee[], projects: Project[]};
export type SSEType = 'info' | 'loop';

const INTERACTION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

type InteractionResolver = {
    timer: ReturnType<typeof setTimeout> | null;
    resolve: (answer: string) => void;
    reject: (reason: string) => void;
};

class LoopGatewayImpl {
    private static loops: LoopStore = {};
    private static sseSubscribers: {[key in SSEType]: ((e: AgentEvent) => void) | undefined} = {
        info: undefined,
        loop: undefined
    };
    private static waitingInteractions: Map<string, InteractionResolver> = new Map();

    private static defaultHandler: AgentHandler = {
        onStreamText: (e) => this.fireSSEEvent('loop', e),
        onToolText: () => {},
        onInteractionEvent: (e) => this.fireWaitedSSEEvent('loop', e),
        onInfoEvent: (e) => this.fireSSEEvent('info', e)
    };

    private static fireSSEEvent(type: SSEType, e: AgentEvent) {
        this.sseSubscribers[type]?.(e);
    }

    private static fireInfoSSEEvent(e: DistributiveOmit<AgentInfoEvent, 'eventType'>): void {
        this.fireSSEEvent('info', { eventType: 'info', ...e });
    }

    public static fireChatMessageEvent(browserId: string, loopId: string, update: boolean, message: ChatMessage): void {
        this.fireSSEEvent('loop', {eventType: 'chat', loopId, browserId, update, message})
    }

    private static fireBusyEvent(loopId: string): void {
        this.fireSSEEvent('loop', { eventType: 'busy', loopId, busy: this.isLoopBusy(loopId) });
    }

    private static async fireWaitedSSEEvent(type: SSEType, e: AgentInteractionEvent): Promise<string> {
        const interactionId = getInteractionId(e.browserId, e.loopId);
        const waiting = new Promise<string>((resolve, reject) => this.waitingInteractions.set(
            interactionId, {timer: null, resolve, reject}
        ));
        this.sseSubscribers[type]?.(e);
        try {
            const timeout = new Promise((res) => {
                const timer = setTimeout(res, INTERACTION_TIMEOUT);
                this.waitingInteractions.get(interactionId)!.timer = timer;
            }).then(() => {
                this.fireSSEEvent('loop', { eventType: 'cancelInteract', loopId: e.loopId, browserId: e.browserId });
                this.cancelInteraction(e.browserId, e.loopId, 'timeout');
            });
            const result = await Promise.race([waiting, timeout]);
            return result || '';
        } finally {
            const timer = this.waitingInteractions.get(interactionId)?.timer;
            if (timer) {
                clearTimeout(timer);
            }
            this.waitingInteractions.delete(interactionId);
        }
    }

    public static init(loopId: string, agentHandler: Partial<Omit<AgentHandler, 'onInfoEvent'>> = {}): void {
        // TODO LRU
        const {agentId, projectId = ''} = splitFlushAgentKey(loopId);
        if (!this.loops[loopId]) {
            this.loops[loopId] = {
                agentId,
                projectId,
                loop: LoopInitializer.getLoop(agentId, projectId, {
                    onStreamText: agentHandler.onStreamText || this.defaultHandler.onStreamText,
                    onToolText: agentHandler.onToolText || this.defaultHandler.onToolText,
                    onInteractionEvent: agentHandler.onInteractionEvent || this.defaultHandler.onInteractionEvent,
                    onInfoEvent: this.defaultHandler.onInfoEvent
                }),
                running: false,
            }
        }
    }

    public static isLoopBusy(loopId: string): boolean {
        return this.loops[loopId]?.running ?? false;
    }

    public static invoke(browserId: string, agentId: string, projectId: string, input: string): void {
        const loopId = getFlushAgentKey(agentId, projectId);
        if (!this.loops[loopId]) {
            this.init(loopId);
        }
        if (this.isLoopBusy(loopId)) {
            return;
        }
        const loopState = this.loops[loopId]!;
        loopState.runtime = undefined;
        loopState.running = true;
        loopState.browserId = browserId;
        this.fireBusyEvent(loopId);
        this.invokeAndReturn(
            loopId, loopState,
            () => loopState.loop.invoke(input, {browserId: loopState.browserId!})
        );
    }

    public static resume(browserId: string, loopId: string): boolean {
        if (!this.loops[loopId]) {
            return false;
        }
        const loopState = this.loops[loopId]!;
        if (loopState.browserId !== browserId || !loopState.runtime) {
            return false;
        }
        const runtime = loopState.runtime!
        loopState.runtime = undefined;
        this.invokeAndReturn(
            loopId, loopState,
            () => loopState.loop.resume({browserId: loopState.browserId!, runtime})
        );
        return true;
    }

    private static invokeAndReturn(
        loopId: string, loopState: LoopState, invoke: () => Promise<AgentInvokeResponse>
    ): void {
        invoke().then(({text, runtime}) => {
            const state = runtime.transitionReason;
            if (!isPauseInLoopReason(state)) {
                if (isExternalStopReason(state)) {
                    this.addMessage(loopState.browserId!, loopId, newMessage('agent', loopState.agentId!, text));
                    loopState.loop.setExternalStopReason(undefined);
                }
                loopState.running = false;
                loopState.browserId = undefined;
                loopState.runtime = undefined;
            } else {
                loopState.runtime = runtime;
            }
        }).catch(() => {}).finally(() => {
            this.fireBusyEvent(loopId);
        });
    }

    public static addMessage(browserId: string, loopId: string, message: ChatMessage): void {
        UIChatService.addMessage(loopId, message);
        this.fireChatMessageEvent(browserId, loopId, false, message);
    }

    public static updateMessage(browserId: string, loopId: string, id: string, text: string): void {
        const message = UIChatService.replaceMessage(loopId, id, text);
        if (message) {
            this.fireChatMessageEvent(browserId, loopId, true, message);
        }
    }

    public static updateLoopConfig(config: DeepclawConfig) {
        for (const agentConfig of config.agents) {
            for (const loopId of Object.keys(this.loops)) {
                const {agentId} = splitFlushAgentKey(loopId);
                if (agentId === agentConfig.id) {
                    this.loops[loopId]!.loop.updateConfig(agentConfig);
                }
            }
        }
    }

    public static subscribe(type: SSEType, cb: (e: AgentEvent) => void): () => void {
        this.sseSubscribers[type] = cb;
        return () => {
            if (this.sseSubscribers[type] === cb) {
                this.sseSubscribers[type] = undefined;
            }
        };
    }

    public static disconnectBrowser(browserId: string) {
        for (const loopId of Object.keys(this.loops)) {
            const loopState = this.loops[loopId];
            if (loopState && loopState.running && loopState.browserId === browserId) {
                loopState.loop.setExternalStopReason('clientLost');
                this.cancelInteraction(browserId, loopId, 'disconnected');
            }
        }
    }

    public static newAgentIdentity(id: string): AgentEmployee {
        const identity = AgentIdentityManager.newAgentIdentity(id);
        const newAgent = {
            ...identity,
            mood: 'none' as const,
        };
        this.fireInfoSSEEvent({ type: 'updateAgent', content: newAgent });
        return newAgent;
    }

    public static updateAgentIdentity(id: string, identity: Partial<AgentIdentity>): void {
        AgentIdentityManager.updateAgentIdentity(id, identity);
        this.fireInfoSSEEvent({ type: 'updateAgent', content: { id, ...identity } });
    }

    public static updateAgentDescription(id: string, description: string): void {
        AgentIdentityManager.updateAgentDescription(id, description);
        this.fireInfoSSEEvent({ type: 'updateAgent', content: { id, description } });
    }

    public static updateProjectTags(projectId: string, tags: string[]): void {
        ProjectManager.updateProject({id: projectId, tags});
        this.fireInfoSSEEvent({ type: 'updateProject', content: { id: projectId, tags } });
    }

    public static updateProjectTask(projectId: string, taskTitle: string, task: Partial<Task>): void {
        ProjectManager.updateTask(projectId, {...task, title: taskTitle});
        this.fireInfoSSEEvent({ type: 'updateProject', content: {
            id: projectId, tasks: ProjectManager.getProjectDetail(projectId).tasks
        }});
    }

    public static resolveInteraction(browserId: string, loopId: string, answer: string): boolean {
        const interactionId = getInteractionId(browserId, loopId);
        const resolver = this.waitingInteractions.get(interactionId);
        if (resolver) {
            resolver.resolve(answer);
            return true;
        }
        return false;
    }

    public static cancelInteraction(browserId: string, loopId: string, reason: InvalidInteractionReason | PauseInLoopReason): void {
        const interactionId = getInteractionId(browserId, loopId);
        const resolver = this.waitingInteractions.get(interactionId);
        if (resolver) {
            resolver.reject(reason);
        }
    }

    public static getLoopInfo(): LoopInfo {
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
}

export const LoopGateway = globalize('LoopGateway', LoopGatewayImpl);
