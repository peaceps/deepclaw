import {
    AgentInfoEvent, AgentInteractionEvent, AgentStreamEvent, AgentToolResultEvent, getFlushAgentKey, AgentInteractionEventConfig
} from './flush-agent-event';

export type LLMGWConfig = {
    model: string,
    timeoutMs: number, // JSON: seconds → client: ms
    temperature: number,
    maxTokens: number
}

export type AgentHandler = {
    onStreamText(e: AgentStreamEvent): void;
    onToolText(e: AgentToolResultEvent): void;
    onInteractionEvent(event: AgentInteractionEvent): Promise<string>;
    onInfoEvent(event: AgentInfoEvent): void;
}

export type SealedAgentHandler = {
    onStreamText(e: Omit<AgentStreamEvent, 'done'|'loopId'|'eventType'>): void;
    onToolText(e: Omit<AgentToolResultEvent, 'eventType'|'loopId'>): void;
    onInteractionEvent(event: Omit<AgentInteractionEvent, 'eventType'|'loopId'>): Promise<string>;
    onInfoEvent(event: Omit<AgentInfoEvent, 'eventType'>): void;
}

export abstract class FlushAgent {
    protected agentId: string;
    protected projectId: string;
    protected agentHandler: SealedAgentHandler;
    private flusher: (e: Omit<AgentStreamEvent, 'done'|'loopId'> & {done: boolean}) => void;

    constructor(
        agentId: string,
        projectId: string = '',
        handler: AgentHandler
    ) {
        this.agentId = agentId;
        this.projectId = projectId;
        this.flusher = (e: Omit<AgentStreamEvent, 'done'|'loopId'> & {done: boolean}) => handler.onStreamText({
            eventType: 'stream',
            loopId: this.getId(),
            text: this.formatLLMText(e.text, e.done),
            done: e.done
        });
        this.agentHandler = {
            onStreamText: (e: Omit<AgentStreamEvent, 'done'|'loopId'|'eventType'>) => this.flusher({
                eventType: 'stream', text: e.text, done: false
            }),
            onToolText: (e: Omit<AgentToolResultEvent, 'eventType'|'loopId'>) => handler.onToolText(
                {eventType: 'toolResult', loopId: this.getId(), ...e}
            ),
            onInteractionEvent: (e: AgentInteractionEventConfig) => handler.onInteractionEvent(
                {eventType: 'interact', loopId: this.getId(), ...e}
            ),
            onInfoEvent: (e: Omit<AgentInfoEvent, 'eventType'>) => handler.onInfoEvent(
                {eventType: 'info', ...e}
            )
        };
    }

    protected abstract _invoke(input: string): Promise<string>;

    protected getId() {
        return getFlushAgentKey(this.agentId, this.projectId);
    }

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
                this.flusher({eventType: 'stream', text: content, done: true});
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
}
