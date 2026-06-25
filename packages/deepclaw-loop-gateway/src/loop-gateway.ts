import type {
    AgentHandler, AgentEmployee, AgentSoulIdentity, Project, AgentInfoEvent,
    AgentStreamEvent
} from "@deepclaw/core";
import { globalize } from "@deepclaw/utils";
import {
    LoopInitializer, ProjectManager, AgentIdentityManager, LoopAgent
} from "@deepclaw/agent";
import { type DeepclawConfig } from "@deepclaw/config";

export type LoopStore = Record<string, Record<string, LoopAgent<unknown, any, any>>>;
export type LoopInfo = {agents: AgentEmployee[], projects: Project[]};
export type SSEType = 'info' | 'loop';

class LoopGatewayImpl {
    private static loops: LoopStore = {};
    private static sseSubscribers: {[key in SSEType]: Set<
        (e: AgentInfoEvent | AgentStreamEvent) => void
    >} = {
        info: new Set(),
        loop: new Set()
    };

    private static defaultHandler: AgentHandler = {
        onStreamText: (e) => LoopGatewayImpl.sseSubscribers.loop.forEach(cb => cb(e)),
        onToolText: () => {},
        onInteractionEvent: () => Promise.resolve(''),
        onInfoEvent: (e) => LoopGatewayImpl.sseSubscribers.info.forEach(cb => cb(e))
    };

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

    public static async invoke(agentId: string, projectId: string, input: string): Promise<string> {
        if (!this.loops[agentId]?.[projectId]) {
            this.init(agentId, projectId, {});
        }
        return this.loops[agentId]![projectId]!.invoke(input);
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

    public static subscribe(type: SSEType, cb: (e: AgentInfoEvent | AgentStreamEvent) => void): () => void {
        this.sseSubscribers[type].add(cb);
        return () => {
            this.sseSubscribers[type].delete(cb);
        };
    }

    public static newAgentIdentity(id: string): AgentEmployee {
        const identity = AgentIdentityManager.newAgentIdentity(id);
        return {
            ...identity,
            mood: 'none',
        };
    }

    public static updateAgentIdentity(id: string, identity: Partial<AgentSoulIdentity>): void {
        AgentIdentityManager.updateAgentIdentity(id, identity);
    }

    public static updateAgentDescription(id: string, description: string): void {
        AgentIdentityManager.updateAgentDescription(id, description);
    }

    public static updateProjectTags(projectId: string, tags: string[]): Project {
        return ProjectManager.updateProjectTags(projectId, tags);
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
