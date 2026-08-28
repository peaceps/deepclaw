import {
    AgentInfoEvent, AgentStreamEvent,
    getLoopId, AgentInteractionEventPayload
} from './flush-agent-event';
import {
    AgentHandler, SealedAgentHandler,
    AgentInvokeOptions, AgentInvokeResponse,
    AgentRuntime,
    FlushAgentRole
} from './flush-agent-types';
/**
 * The one shape text takes on its way to a screen. Whoever holds on to a copy of what was streamed
 * has to hold this one: a message written from text of another shape is a message that differs from
 * what was watched being written, by the line endings a model happened to answer in.
 */
export function streamShape(text: string): string {
    return text.replace(/\r\n/g, '\n');
}

export abstract class FlushAgent {
    protected role: FlushAgentRole;
    protected agentId: string;
    protected projectId: string;
    protected agentHandler: SealedAgentHandler;
    private flusher: (e: Omit<AgentStreamEvent, 'done'|'loopId'> & {done: boolean}) => void;

    constructor(
        flushAgentRole: FlushAgentRole,
        agentId: string,
        projectId: string,
        handler: AgentHandler
    ) {
        this.role = flushAgentRole;
        this.agentId = agentId;
        this.projectId = projectId;
        this.flusher = (e: Omit<AgentStreamEvent, 'done'|'loopId'|'eventType'> & {done: boolean}) => handler.onStreamText({
            eventType: 'stream',
            loopId: this.getId(),
            browserId: e.browserId,
            tag: e.tag,
            text: this.formatLLMText(e.text, e.done),
            done: e.done
        });
        this.agentHandler = {
            onStreamText: (e: Omit<AgentStreamEvent, 'done'|'loopId'|'eventType'>) => this.flusher({
                eventType: 'stream', browserId: e.browserId, text: e.text, tag: e.tag, done: false
            }),
            onInteractionEvent: (e: AgentInteractionEventPayload & {browserId: string}) => handler.onInteractionEvent(
                {eventType: 'interaction', loopId: this.getId(), ...e}
            ),
            onInfoEvent: (e: AgentInfoEvent) => handler.onInfoEvent(e)
        };
    }

    protected abstract _invoke(input: string, options: AgentInvokeOptions): Promise<AgentInvokeResponse>;

    protected getId() {
        return getLoopId(this.role, this.agentId, this.projectId);
    }

    async invoke(input: string, options: AgentInvokeOptions): Promise<AgentInvokeResponse> {
        try {
            return this.finishInvoke(options.browserId, await this._invoke(input, options));
        } catch (e: any) {
            // Nothing was streamed on a way out like this, so the whole of what happened is the
            // one line, and it is all either reader can be given.
            const text = e?.message || '';
            return this.finishInvoke(options.browserId, {text, said: text, runtime: this.emptyRuntime()});
        }
    }

    protected emptyRuntime(): AgentRuntime {
        return {
            turnCount: 0,
            historyPersistIndex: 0,
            recoveryState: {
                maxTokenRetries: 0,
                inputMaxTokenRetries: 0,
                refusalState: '' // TODO: 添加拒绝状态
            },
            usage: {
                cachedInputTokens: 0,
                noCachedInputTokens: 0,
                outputTokens: 0
            }
        }
    }

    /**
     * The last event of a stream, which says the stream is over and carries the answer with it.
     *
     * Nothing reads that text today: every reader of a stream watched it arrive and holds it
     * already, and takes the run itself from the message written from the response. So the answer
     * rides along as the shape of the event and not as anything anybody is being told -- which is
     * also why it is the answer and not the run, a reader who took it for the run being one that
     * put the last line of it in place of everything above.
     */
    private finishInvoke(browserId: string, response: AgentInvokeResponse): Promise<AgentInvokeResponse> {
        return new Promise((resolve) => {
            setTimeout(() => {
                this.flusher({eventType: 'stream', browserId, text: response.text, done: true});
                resolve(response);
            }, 100);
        });
    }
    
    private formatLLMText(text: string, done: boolean): string {
        if (!text) return '';
        const result = streamShape(text);
        return done ? result.trimEnd() : result;
    }
}
