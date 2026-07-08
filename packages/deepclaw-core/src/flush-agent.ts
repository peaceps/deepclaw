import { DistributiveOmit } from '@deepclaw/utils';
import {
    AgentInfoEvent, AgentStreamEvent, AgentToolResultEvent,
    getFlushAgentKey, AgentInteractionEventPayload
} from './flush-agent-event';
import {
    AgentHandler, SealedAgentHandler, TransitionReason,
    AgentInvokeOptions, AgentInvokeResponse
} from './flush-agent-types';

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
            browserId: e.browserId,
            text: this.formatLLMText(e.text, e.done),
            done: e.done
        });
        this.agentHandler = {
            onStreamText: (e: Omit<AgentStreamEvent, 'done'|'loopId'|'eventType'>) => this.flusher({
                eventType: 'stream', browserId: e.browserId, text: e.text, done: false
            }),
            onToolText: (e: Omit<AgentToolResultEvent, 'eventType'|'loopId'>) => handler.onToolText(
                {eventType: 'toolResult', loopId: this.getId(), ...e}
            ),
            onInteractionEvent: (e: AgentInteractionEventPayload & {browserId: string}) => handler.onInteractionEvent(
                {eventType: 'interact', loopId: this.getId(), ...e}
            ),
            onInfoEvent: (e: DistributiveOmit<AgentInfoEvent, 'eventType'>) => handler.onInfoEvent(
                {eventType: 'info', ...e}
            )
        };
    }

    protected abstract _invoke(input: string, options?: AgentInvokeOptions): Promise<AgentInvokeResponse>;

    protected getId() {
        return getFlushAgentKey(this.agentId, this.projectId);
    }

    async invoke(input: string, options: AgentInvokeOptions): Promise<AgentInvokeResponse> {
        try {
            const res = await this._invoke(input, options);
            return this.finishInvoke(options.browserId, res.text, res.state);
        } catch (e: any) {
            return this.finishInvoke(options.browserId, e?.message || '', 'error');
        }
    }

    private finishInvoke(browserId: string, content: string, state: TransitionReason): Promise<AgentInvokeResponse> {
        return new Promise((resolve) => {
            setTimeout(() => {
                this.flusher({eventType: 'stream', browserId, text: content, done: true});
                resolve({text: content, state});
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
