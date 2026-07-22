import {
    AgentInfoEvent, AgentStreamEvent,
    getLoopId, AgentInteractionEventPayload
} from './flush-agent-event';
import {
    AgentHandler, SealedAgentHandler,
    AgentInvokeOptions, AgentInvokeResponse,
    AgentRuntime,
    BREAK_POINTS,
    FlushAgentRole
} from './flush-agent-types';

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

    protected abstract _invoke(input: string, options?: AgentInvokeOptions): Promise<AgentInvokeResponse>;

    protected abstract _resume(options: AgentInvokeOptions & {runtime: AgentRuntime}): Promise<AgentInvokeResponse>;

    protected getId() {
        return getLoopId(this.role, this.agentId, this.projectId);
    }

    async resume(options: AgentInvokeOptions & {runtime: AgentRuntime}): Promise<AgentInvokeResponse> {
        try {
            const res = await this._resume(options);
            return this.finishInvoke(options.browserId, res.text, res.runtime);
        } catch (e: any) {
            return this.finishInvoke(options.browserId, e?.message || '', this.emptyRuntime());
        }
    }

    async invoke(input: string, options: AgentInvokeOptions): Promise<AgentInvokeResponse> {
        try {
            const res = await this._invoke(input, options);
            return this.finishInvoke(options.browserId, res.text, res.runtime);
        } catch (e: any) {
            return this.finishInvoke(options.browserId, e?.message || '', this.emptyRuntime());
        }
    }

    protected emptyRuntime(): AgentRuntime {
        return {
            turnCount: 0,
            historyPersistIndex: 0,
            breakPoint: {point: BREAK_POINTS.none},
            recoveryState: {
                maxTokenRetries: 0,
                refusalState: '' // TODO: 添加拒绝状态
            },
            usage: {
                cachedInputTokens: 0,
                noCachedInputTokens: 0,
                outputTokens: 0
            }
        }
    }

    private finishInvoke(browserId: string, content: string, runtime: AgentRuntime): Promise<AgentInvokeResponse> {
        return new Promise((resolve) => {
            setTimeout(() => {
                this.flusher({eventType: 'stream', browserId, text: content, done: true});
                resolve({text: content, runtime});
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
