import type {
    AgentHandler, AgentEmployee, Project, AgentInfoEvent,
    AgentStreamEvent, AgentLoopBusyEvent,
    Task,
    AgentIdentity
} from "@deepclaw/core";
import { getFlushAgentKey } from "@deepclaw/core";
import { globalize } from "@deepclaw/utils";
import {
    LoopInitializer, ProjectManager, AgentIdentityManager, LoopAgent
} from "@deepclaw/agent";
import { type DeepclawConfig } from "@deepclaw/config";

export type LoopStore = Record<string, Record<string, LoopAgent<unknown, any, any>>>;
export type LoopInfo = {agents: AgentEmployee[], projects: Project[]};
export type SSEType = 'info' | 'loop';
export type LoopSSEEvent = AgentInfoEvent | AgentStreamEvent | AgentLoopBusyEvent;

export const LOOP_BUSY_ERROR = 'LOOP_BUSY';

class LoopGatewayImpl {
    private static loops: LoopStore = {};
    private static busyLoops = new Set<string>();
    private static sseSubscribers: {[key in SSEType]: Set<
        (e: LoopSSEEvent) => void
    >} = {
        info: new Set(),
        loop: new Set()
    };

    private static defaultHandler: AgentHandler = {
        onStreamText: (e) => this.fireSSEEvent('loop', e),
        onToolText: () => {},
        onInteractionEvent: () => Promise.resolve(''),
        onInfoEvent: (e) => this.fireSSEEvent('info', e)
    };

    private static fireSSEEvent(type: SSEType, e: LoopSSEEvent) {
        this.sseSubscribers[type].forEach(cb => cb(e));
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
        this.sseSubscribers.loop.forEach(cb => cb({ loopId, busy }));
    }

    public static async invoke(agentId: string, projectId: string, input: string): Promise<string> {
        const loopId = getFlushAgentKey(agentId, projectId);
        if (this.busyLoops.has(loopId)) {
            throw new Error(LOOP_BUSY_ERROR);
        }
        if (!this.loops[agentId]?.[projectId]) {
            this.init(agentId, projectId, {});
        }
        this.busyLoops.add(loopId);
        this.broadcastLoopBusy(loopId, true);
        try {
            return await this.loops[agentId]![projectId]!.invoke(input);
        } finally {
            this.busyLoops.delete(loopId);
            this.broadcastLoopBusy(loopId, false);
        }
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

    public static subscribe(type: SSEType, cb: (e: LoopSSEEvent) => void): () => void {
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
        this.fireSSEEvent('info', { type: 'updateAgent', content: newAgent });
        return newAgent;
    }

    public static updateAgentIdentity(id: string, identity: Partial<AgentIdentity>): void {
        AgentIdentityManager.updateAgentIdentity(id, identity);
        this.fireSSEEvent('info', { type: 'updateAgent', content: { id, ...identity } });
    }

    public static updateAgentDescription(id: string, description: string): void {
        AgentIdentityManager.updateAgentDescription(id, description);
        this.fireSSEEvent('info', { type: 'updateAgent', content: { id, description } });
    }

    public static updateProjectTags(projectId: string, tags: string[]): void {
        ProjectManager.updateProject({id: projectId, tags});
        this.fireSSEEvent('info', { type: 'updateProject', content: { id: projectId, tags } });
    }

    public static updateProjectTask(projectId: string, taskTitle: string, task: Partial<Task>): void {
        ProjectManager.updateTask(projectId, {...task, title: taskTitle});
        this.fireSSEEvent('info', { type: 'updateProject', content: {
            id: projectId, tasks: ProjectManager.getProjectDetail(projectId).tasks
        }});
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
