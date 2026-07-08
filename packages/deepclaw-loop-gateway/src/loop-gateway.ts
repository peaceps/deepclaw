import type {
    AgentHandler, AgentEmployee, Project, AgentEvent, Task, AgentIdentity,
    AgentInteractionEvent,
    AgentInfoEvent,
    ChatMessage
} from "@deepclaw/core";
import {
    getFlushAgentKey, getInteractionId, isExternalStopReason, isPauseInLoopReason, LOOP_BUSY_ERROR, newMessage, splitFlushAgentKey
} from "@deepclaw/core";
import { DistributiveOmit, globalize } from "@deepclaw/utils";
import {
    LoopInitializer, ProjectManager, AgentIdentityManager, LoopAgent
} from "@deepclaw/agent";
import { type DeepclawConfig } from "@deepclaw/config";
import { UIChatService } from "./ui-chat-service";

type LoopState = {
    loop: LoopAgent<unknown, any, any>;
    running: boolean;
    clientId?: string;
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

    public static fireChatMessageEvent(loopId: string, clientId: string, update: boolean, message: ChatMessage): void {
        this.fireSSEEvent('loop', {eventType: 'chat', loopId, clientId, update, message})
    }

    private static fireBusyEvent(loopId: string): void {
        this.fireSSEEvent('loop', { eventType: 'busy', loopId, busy: this.isLoopBusy(loopId) });
    }

    private static async fireWaitedSSEEvent(type: SSEType, e: AgentInteractionEvent): Promise<string> {
        const interactionId = getInteractionId(e.loopId, e.clientId);
        const waiting = new Promise<string>((resolve, reject) => this.waitingInteractions.set(
            interactionId, {timer: null, resolve, reject}
        ));
        this.sseSubscribers[type]?.(e);
        try {
            const timeout = new Promise((res) => {
                const timer = setTimeout(res, INTERACTION_TIMEOUT);
                this.waitingInteractions.get(interactionId)!.timer = timer;
            }).then(() => {
                this.fireSSEEvent('loop', { eventType: 'cancelInteract', loopId: e.loopId, clientId: e.clientId });
                this.cancelInteraction(e.loopId, e.clientId, 'Interaction timed out');
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

    public static async invoke(agentId: string, projectId: string, clientId: string, input: string): Promise<void> {
        const loopId = getFlushAgentKey(agentId, projectId);
        if (!this.loops[loopId]) {
            this.init(loopId);
        }
        if (this.isLoopBusy(loopId)) {
            throw new Error(LOOP_BUSY_ERROR);
        }
        const loopState = this.loops[loopId]!;
        loopState.running = true;
        loopState.clientId = clientId;
        this.fireBusyEvent(loopId);
        loopState.loop.invoke(input, {clientId}).then(({text, state}) => {
            if (!isPauseInLoopReason(state)) {
                loopState.running = false;
                if (isExternalStopReason(state)) {
                    this.addMessage(loopId, clientId, newMessage('agent', agentId, text));
                    loopState.loop.setExternalStopReason(undefined);
                }
                loopState.clientId = undefined;
            }
        }).catch(() => {}).finally(() => {
            this.fireBusyEvent(loopId);
        });
    }

    public static addMessage(loopId: string, clientId: string, message: ChatMessage): void {
        UIChatService.addMessage(loopId, message);
        this.fireChatMessageEvent(loopId, clientId, false, message);
    }

    public static updateMessage(loopId: string, clientId: string, id: string, text: string): void {
        const message = UIChatService.replaceMessage(loopId, id, text);
        if (message) {
            this.fireChatMessageEvent(loopId, clientId, true, message);
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

    public static disconnectBrowser(clientId: string) {
        for (const loopId of Object.keys(this.loops)) {
            const loopState = this.loops[loopId];
            if (loopState && loopState.running && loopState.clientId === clientId) {
                loopState.loop.setExternalStopReason('clientLost');
                this.cancelInteraction(loopId, clientId, `Client ${clientId} disconnected.`);
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

    public static resolveInteraction(loopId: string, clientId: string, answer: string): boolean {
        const interactionId = getInteractionId(loopId, clientId);
        const resolver = this.waitingInteractions.get(interactionId);
        if (resolver) {
            resolver.resolve(answer);
            return true;
        }
        return false;
    }

    public static cancelInteraction(loopId: string, clientId: string, reason: string): void {
        const interactionId = getInteractionId(loopId, clientId);
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
