import type {
    AgentHandler, AgentEmployee, Project, AgentEvent, Task, AgentIdentity,
    AgentInteractionEvent,
    AgentInfoEvent
} from "@deepclaw/core";
import { getFlushAgentKey, getInteractionId, LOOP_BUSY_ERROR } from "@deepclaw/core";
import { globalize } from "@deepclaw/utils";
import {
    LoopInitializer, ProjectManager, AgentIdentityManager, LoopAgent
} from "@deepclaw/agent";
import { type DeepclawConfig } from "@deepclaw/config";

export type LoopStore = Record<string, Record<string, LoopAgent<unknown, any, any>>>;
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
    private static busyLoops = new Set<string>();
    private static sseSubscribers: {[key in SSEType]: Set<(e: AgentEvent) => void>} = {
        info: new Set(),
        loop: new Set()
    };
    private static waitingInteractions: Map<string, InteractionResolver> = new Map();

    private static defaultHandler: AgentHandler = {
        onStreamText: (e) => this.fireSSEEvent('loop', e),
        onToolText: () => {},
        onInteractionEvent: (e) => this.fireWaitedSSEEvent('loop', e),
        onInfoEvent: (e) => this.fireSSEEvent('info', e)
    };

    private static fireSSEEvent(type: SSEType, e: AgentEvent) {
        this.sseSubscribers[type].forEach(cb => cb(e));
    }

    private static async fireWaitedSSEEvent(type: SSEType, e: AgentInteractionEvent): Promise<string> {
        const interactionId = getInteractionId(e.loopId, e.clientId);
        const waiting = new Promise<string>((resolve, reject) => this.waitingInteractions.set(
            interactionId, {timer: null, resolve, reject}
        ));
        this.sseSubscribers[type].forEach(cb => cb(e));
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

    private static fireInfoSSEEvent(e: Omit<AgentInfoEvent, 'eventType'>): void {
        this.sseSubscribers['info'].forEach(cb => cb({ eventType: 'info', ...e }));
    }

    public static init(agentId: string, projectId: string, agentHandler: Partial<Omit<AgentHandler, 'onInfoEvent'>>): void {
        if (!this.loops[agentId]) {
            this.loops[agentId] = {};
        }
        // TODO LRU
        if (!this.loops[agentId][projectId]) {
            this.loops[agentId][projectId] = LoopInitializer.getLoop(agentId, projectId, {
                onStreamText: agentHandler.onStreamText || this.defaultHandler.onStreamText,
                onToolText: agentHandler.onToolText || this.defaultHandler.onToolText,
                onInteractionEvent: agentHandler.onInteractionEvent || this.defaultHandler.onInteractionEvent,
                onInfoEvent: this.defaultHandler.onInfoEvent
            });
        }
    }

    public static isLoopBusy(loopId: string): boolean {
        return this.busyLoops.has(loopId);
    }

    private static broadcastLoopBusy(loopId: string, busy: boolean): void {
        this.sseSubscribers.loop.forEach(cb => cb({ eventType: 'busy', loopId, busy }));
    }

    public static async invoke(agentId: string, projectId: string, clientId: string, input: string): Promise<void> {
        const loopId = getFlushAgentKey(agentId, projectId);
        if (this.busyLoops.has(loopId)) {
            throw new Error(LOOP_BUSY_ERROR);
        }
        if (!this.loops[agentId]?.[projectId]) {
            this.init(agentId, projectId, {});
        }
        this.busyLoops.add(loopId);
        this.broadcastLoopBusy(loopId, true);
        this.loops[agentId]![projectId]!.invoke(input, {clientId}).catch(() => {}).finally(() => {
            this.busyLoops.delete(loopId);
            this.broadcastLoopBusy(loopId, false);
        });
    }

    public static updateLoopConfig(config: DeepclawConfig) {
        for (const agentConfig of config.agents) {
            if (!this.loops[agentConfig.id]) {
                continue;
            }
            for (const projectId of Object.keys(this.loops[agentConfig.id]!)) {
                this.loops[agentConfig.id]![projectId]!.updateConfig(agentConfig);
            }
        }
    }

    public static subscribe(type: SSEType, cb: (e: AgentEvent) => void): () => void {
        this.sseSubscribers[type].add(cb);
        return () => {
            this.sseSubscribers[type].delete(cb);
        };
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
