import { type FlushAgent, type AgentHandler } from "@deepclaw/core";
import { LoopInitializer, ProjectManager, type Task } from "@deepclaw/agent";

type DeepClawData = {
    tasks: Task[];
    agents: {

    }[];
}

// Todo REMOVE
export function getTestTasks() {
    return ProjectManager.getTestTasks();
}

export class LoopGateway {
    private static instance: LoopGateway;
    private loop: FlushAgent;
    private data: DeepClawData = {
        tasks: [],
        agents: [],
    };
    private subscribers: ((data: DeepClawData) => void)[] = [];

    public static init(agentHandler: Partial<AgentHandler>): LoopGateway {
        if (!this.instance) {
            this.instance = new LoopGateway(agentHandler);
            this.instance.data.tasks = ProjectManager.getTestTasks();
        }
        return this.instance;
    }

    public static getData(): DeepClawData {
        if (!this.instance) {
            throw new Error('LoopGateway not initialized');
        }
        return this.instance.data;
    }

    public static subscribe(cb: (data: DeepClawData) => void): () => void {
        if (!this.instance) {
            throw new Error('LoopGateway not initialized');
        }
        this.instance.subscribers.push(cb);
        return () => {
            const index = this.instance.subscribers.indexOf(cb);
            if (index !== -1) {
                this.instance.subscribers.splice(index, 1);
            }
        };
    }

    private constructor(agentHandler: Partial<AgentHandler>) {
        const defaultHandler: AgentHandler = {
            onStreamText: () => {},
            onToolText: () => {},
            onInteractionEvent: () => Promise.resolve(''),
            onInfoEvent: () => LoopGateway.instance.subscribers.forEach(cb => cb(this.data))
        };
        this.loop = LoopInitializer.getLoop({
            onStreamText: agentHandler.onStreamText || defaultHandler.onStreamText,
            onToolText: agentHandler.onToolText || defaultHandler.onToolText,
            onInteractionEvent: agentHandler.onInteractionEvent || defaultHandler.onInteractionEvent,
            onInfoEvent: agentHandler.onInfoEvent || defaultHandler.onInfoEvent
        });
    }

    public invoke(input: string): Promise<string> {
        return this.loop.invoke(input);
    }

}