import { AgentInfoEvent, AgentInteractionEvent } from './agent-event';

export type FlushAgentConstructor = new (
    agentIdentity: AgentIdentity,
    handler: AgentHandler
) => FlushAgent;

export type AgentHandler = {
    onStreamText(content: string, done?: boolean): void;
    onToolText(content: string): void;
    onInteractionEvent(event: AgentInteractionEvent): Promise<string|boolean|number>;
    onInfoEvent(event: AgentInfoEvent): void;
}

export type SealedAgentHandler = AgentHandler & {
    onStreamText(content: string): void;
}

export type AgentIdentity = {
  id: string;
  name: string;
  avatar: string;
  role: string;
  description: string;
  personalities: string[];
  emotion: boolean;
  skills: string[];
}

export type AgentStatus = {
  status: 'busy' | 'idle' | 'offline';
  mood: 'happy' | 'focused' | 'tired' | 'confused' | 'none';
  stats: {
    tasksCompleted: number;
  };
}

export type AgentEmployee = AgentIdentity & AgentStatus;

export abstract class FlushAgent {
    protected agentHandler: AgentHandler;
    private flusher: (content: string, done: boolean) => void;

    constructor(
        handler: AgentHandler
    ) {
        this.flusher = (text: string, done: boolean) => handler.onStreamText(this.formatLLMText(text, done), done);
        this.agentHandler = {
            onStreamText: (text: string) => this.flusher(text, false),
            onToolText: (text: string) => handler.onToolText(text),
            onInteractionEvent: handler.onInteractionEvent,
            onInfoEvent: handler.onInfoEvent
        };
    }

    protected abstract _invoke(input: string): Promise<string>;

    async invoke(input: string): Promise<string> {
        try {
            const res = await this._invoke(input);
            return this.finishInvoke(res);
        } catch (e: any) {
            return this.finishInvoke(e?.message || '');
        }
    }

    private finishInvoke(content: string): Promise<string> {
        return new Promise((resolve) => {
            setTimeout(() => {
                this.flusher(content, true);
                resolve(content);
            }, 100);
        });
    }
    
    private formatLLMText(text: string, done: boolean): string {
        if (!text) return '';
        let result = text.replace(/\r\n/g, '\n');
        if (done) {
            result = result.trimEnd();
        }
        return result;
    }

    public abstract getIdentity(): AgentIdentity;
}
