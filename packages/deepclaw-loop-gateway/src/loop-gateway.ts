import type {
    AgentHandler, AgentEmployee, Project, Task, AgentIdentity,
    AgentInteractionEvent,
    ChatMessage,
    InvalidInteractionReason,
    ToolInteractionPauseReason,
    AgentRuntime,
    AgentInvokeResponse
} from "@deepclaw/core";
import {
    getFlushAgentKey, getInteractionId, isExternalStopReason, isToolInteractionPauseReason,
    newMessage, splitFlushAgentKey
} from "@deepclaw/core";
import { globalize } from "@deepclaw/utils";
import {
    LoopInitializer, ProjectManager, AgentIdentityManager, LoopAgent
} from "@deepclaw/agent";
import { type DeepclawConfig } from "@deepclaw/config";
import { UIChatService } from "./ui-chat-service";
import { LoopGatewayEvent } from "./loop-gateway-types";

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

const INTERACTION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

type InteractionResolver = {
    timer: ReturnType<typeof setTimeout> | null;
    resolve: (answer: string) => void;
    reject: (reason: string) => void;
};

class LoopGatewayImpl {
    private static loops: LoopStore = {};
    private static sseSubscriber: ((e: LoopGatewayEvent) => void) | undefined;
    private static waitingInteractions: Map<string, InteractionResolver> = new Map();

    private static defaultHandler: AgentHandler = {
        onStreamText: (e) => this.fireSSEEvent(e),
        onToolText: () => {},
        onInteractionEvent: (e) => this.fireWaitedSSEEvent(e),
        onInfoEvent: (e) => this.fireSSEEvent(e)
    };

    private static fireSSEEvent(e: LoopGatewayEvent) {
        this.sseSubscriber?.(e);
    }

    public static fireChatMessageEvent(browserId: string, loopId: string, update: boolean, message: ChatMessage): void {
        this.fireSSEEvent({eventType: 'chat', loopId, browserId, update, message})
    }

    private static fireBusyEvent(loopId: string): void {
        this.fireSSEEvent({ eventType: 'busy', loopId, busy: this.isLoopBusy(loopId) });
    }

    private static async fireWaitedSSEEvent(e: AgentInteractionEvent): Promise<string> {
        const interactionId = getInteractionId(e.browserId, e.loopId);
        const waiting = new Promise<string>((resolve, reject) => this.waitingInteractions.set(
            interactionId, {timer: null, resolve, reject}
        ));
        this.sseSubscriber?.(e);
        try {
            const timeout = new Promise((res) => {
                const timer = setTimeout(res, INTERACTION_TIMEOUT);
                this.waitingInteractions.get(interactionId)!.timer = timer;
            }).then(() => {
                this.fireSSEEvent({ eventType: 'cancelInteraction', loopId: e.loopId, browserId: e.browserId });
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

    public static invoke(browserId: string, agentId: string, projectId: string, input: string): boolean {
        const loopId = getFlushAgentKey(agentId, projectId);
        if (!this.loops[loopId]) {
            this.init(loopId);
        }
        if (this.isLoopBusy(loopId)) {
            return true;
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
        return false;
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
            const state = runtime.interruptReason;
            if (!isToolInteractionPauseReason(state)) {
                if (isExternalStopReason(state)) {
                    this.addMessage(loopState.browserId!, loopId, newMessage('agent', loopState.agentId!, text));
                    loopState.loop.setExternalStopReason(undefined);
                }
                this.clearLoopState(loopState);
            } else {
                loopState.runtime = runtime;
            }
        }).catch(() => {
            this.clearLoopState(loopState);
        }).finally(() => {
            this.fireBusyEvent(loopId);
        });
    }

    private static clearLoopState(loopState: LoopState): void {
        loopState.running = false;
        loopState.browserId = undefined;
        loopState.runtime = undefined;
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

    public static subscribe(cb: (e: LoopGatewayEvent) => void): () => void {
        this.sseSubscriber = cb;
        return () => {
            if (this.sseSubscriber === cb) {
                this.sseSubscriber = undefined;
            }
        };
    }

    public static disconnectBrowser(browserId: string) {
        for (const loopId of Object.keys(this.loops)) {
            const loopState = this.loops[loopId];
            if (loopState && loopState.running && loopState.browserId === browserId) {
                loopState.loop.setExternalStopReason('clientLost');
                this.cancelInteraction(browserId, loopId, 'disconnected');
                if (loopState.runtime) {
                    this.resume(loopState.browserId, loopId);
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

    public static updateAgentIdentity(id: string, identity: Partial<AgentIdentity>): void {
        AgentIdentityManager.updateAgentIdentity(id, identity);
        this.fireSSEEvent({ eventType: 'updateAgent', content: { id, ...identity } });
    }

    public static updateAgentDescription(id: string, description: string): void {
        AgentIdentityManager.updateAgentDescription(id, description);
        this.fireSSEEvent({ eventType: 'updateAgent', content: { id, description } });
    }

    public static updateProjectTags(projectId: string, tags: string[]): void {
        ProjectManager.updateProject({id: projectId, tags});
        this.fireSSEEvent({ eventType: 'updateProject', content: { id: projectId, tags } });
    }

    public static updateProjectTask(projectId: string, taskTitle: string, task: Partial<Task>): void {
        ProjectManager.updateTask(projectId, {...task, title: taskTitle});
        this.fireSSEEvent({ eventType: 'updateProject', content: {
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

    public static cancelInteraction(
        browserId: string, loopId: string, reason: InvalidInteractionReason | ToolInteractionPauseReason
    ): void {
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
