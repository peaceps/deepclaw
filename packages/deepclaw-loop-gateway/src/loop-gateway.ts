import type {
    AgentHandler, AgentEmployee, Project, Task, AgentIdentity,
    AgentInteractionEvent,
    ChatMessage,
    InvalidInteractionReason,
    InternalInterruptReason,
    AgentRuntime,
    AgentInvokeResponse
} from "@deepclaw/core";
import {
    getLoopId, isInternalInterruptReason, newMessage, splitLoopId
} from "@deepclaw/core";
import { globalize } from "@deepclaw/utils";
import {
    LoopInitializer, ProjectManager, AgentIdentityManager, LoopAgent
} from "@deepclaw/agent";
import { type DeepclawConfig } from "@deepclaw/config";
import { UIChatService } from "./ui-chat-service";
import { LoopGatewayEvent, getClientKey } from "./loop-gateway-types";
import { i18nInstance } from "@deepclaw/i18n";

type LoopState = {
    agentId: string;
    projectId: string;
    loop: LoopAgent<unknown, any, any>;
    running: boolean;
    msgId?: string;
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
        const clientKey = getClientKey(e.browserId, e.loopId);
        const waiting = new Promise<string>((resolve, reject) => this.waitingInteractions.set(
            clientKey, {timer: null, resolve, reject}
        ));
        this.sseSubscriber?.(e);
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

    public static init(loopId: string, agentHandler: Partial<Omit<AgentHandler, 'onInfoEvent'>> = {}): void {
        // TODO LRU
        const {agentId, projectId = ''} = splitLoopId(loopId);
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

    public static invoke(
        browserId: string, agentId: string, projectId: string, input: string
    ): {busy: boolean, msgId: string} {
        const loopId = getLoopId(agentId, projectId);
        if (!this.loops[loopId]) {
            this.init(loopId);
        }
        const agentMessages = newMessage('agent', agentId, '');
        this.addMessage('', loopId, agentMessages);
        if (this.isLoopBusy(loopId)) {
            this.updateMessage('', loopId, agentMessages.id, i18nInstance.t('gateway.busy'));
            return {busy: true, msgId: agentMessages.id};
        }
        this.fireBusyEvent(loopId);
        const loopState = this.loops[loopId]!;
        loopState.runtime = undefined;
        loopState.running = true;
        loopState.browserId = browserId;
        loopState.msgId = agentMessages.id;
        this.invokeAndReturn(
            loopId, loopState,
            () => loopState.loop.invoke(input, {browserId: loopState.browserId!})
        );
        return {busy: false, msgId: agentMessages.id};
    }

    public static resume(browserId: string, loopId: string): {resume: boolean, msgId: string} {
        if (!this.loops[loopId]) {
            return {resume: false, msgId: ''};
        }
        const loopState = this.loops[loopId]!;
        if (loopState.browserId !== browserId || !loopState.runtime) {
            return {resume: false, msgId: ''};
        }
        const runtime = loopState.runtime!
        loopState.runtime = undefined;
        this.invokeAndReturn(
            loopId, loopState,
            () => loopState.loop.resume({browserId: loopState.browserId!, runtime})
        );
        return {resume: true, msgId: loopState.msgId!};
    }

    private static invokeAndReturn(
        loopId: string, loopState: LoopState, invoke: () => Promise<AgentInvokeResponse>
    ): void {
        invoke().then(({text, runtime}) => {
            const state = runtime.agentBreakReason;
            if (!isInternalInterruptReason(state)) {
                this.updateMessage('', loopId, loopState.msgId!, text);
                this.clearLoopState(loopState);
            } else {
                loopState.runtime = runtime;
                loopState.runtime.agentBreakReason = undefined;
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
        loopState.msgId = undefined;
        loopState.runtime = undefined;
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

    public static updateLoopConfig(config: DeepclawConfig) {
        for (const agentConfig of config.agents) {
            for (const loopId of Object.keys(this.loops)) {
                const {agentId} = splitLoopId(loopId);
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
                loopState.loop.setExternalInterruptReason('clientLost');
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
