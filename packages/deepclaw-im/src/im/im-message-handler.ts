import { AgentInteractionEvent, getLoopId, newMessage, type ImageContent } from "@deepclaw/core";
import { isCurrentConfigValid } from "@deepclaw/config";
import { i18nInstance } from '@deepclaw/i18n';
import { parseStringifiedAnswer, stringifiedInteractionEvent } from "../utils/stringified-event";
import { LoopGateway } from "@deepclaw/loop-gateway";
import { randomUUID } from "node:crypto";
import { getLogger } from '@deepclaw/node-utils';

const logger = getLogger('IMMessageHandler');

export type ParsedMessage<M> = {
    id: string;
    text: string;
    body: M;
    fetchImages?: () => Promise<ImageContent[] | undefined>;
}

export abstract class IMMessageHandler<E, M> {
    private agentId: string;
    private loopId: string;
    private handledMessages: Set<string> = new Set();
    private processingMessages: Map<string, M> = new Map();
    private interactionResolver: ((r: string) => void) | null = null;
    private sequentialInteraction: Promise<void> = Promise.resolve();
    
    constructor(agentId: string) {
        this.agentId = agentId;
        this.loopId = getLoopId('agent', agentId);
    }

    private handleInteractionEvent(messageId: string, event: AgentInteractionEvent): Promise<string> {
        this.sendMessage(messageId, stringifiedInteractionEvent(event));
        return event.type === 'readonly' ? Promise.resolve('') : new Promise<string>((resolve) => {
            this.interactionResolver = resolve;
        }).then(async (answer: string) => {
            return await parseStringifiedAnswer(
                event,
                answer,
                c => this.sendMessage(messageId, c),
                (e) => this.handleInteractionEvent(messageId, e)
            );
        });
    }

    public onMessage(event: E) {
        try {
            this.preHandleMessage(event);

            const parsedMessage = this.parseMessage(event);
            if (!parsedMessage) {
                return;
            }
            const {id, text, body, fetchImages} = parsedMessage;
            if (this.handledMessages.has(id)) {
                return;
            }
            this.addHandledMessage(id);

            this.processingMessages.set(id, body);

            if (!isCurrentConfigValid()) {
                this.sendMessage(id, i18nInstance.t('im.invalidConfig'), true);
                return;
            }

            if (this.interactionResolver) {
                const resolver = this.interactionResolver;
                this.interactionResolver = null;
                resolver(text);
                this.processingMessages.delete(id);
                return;
            }

            if (LoopGateway.isLoopBusy(this.loopId)) {
                this.sendMessage(id, i18nInstance.t('im.busy'), true);
                return;
            }

            this.sendMessage(id, i18nInstance.t('im.wait'));

            // images are downloaded inside the queue so that messages keep their arrival order.
            // invoke returns once the agent has started, its answer and its questions arrive later,
            // so the message stays open until the agent answers (onDone), the run comes back busy,
            // or the run throws.
            this.sequentialInteraction = this.sequentialInteraction
                .then(() => fetchImages?.())
                .then((images) => {
                    LoopGateway.addMessage('', this.loopId, newMessage('user', this.agentId, `📱 ${text}`, images));
                    const {busy} = LoopGateway.invoke(
                        {role: 'agent', agentId: this.agentId, projectId: ''},
                        {source: 'im', browserId: randomUUID(), images}, text,
                        {onInteractionEvent: (e: AgentInteractionEvent) => this.handleInteractionEvent(id, e)},
                        (answer) => this.sendMessage(id, answer, true)
                    );
                    if (busy) {
                        this.sendMessage(id, i18nInstance.t('im.busy'), true);
                    }
                })
                .catch((e) => {
                    const error = `${i18nInstance.t('im.error')}: ${e?.message}`
                    this.sendMessage(id, error, true);
                });
        } catch(e) {
            logger.error(`message processing error, simply ignore it: ${e}`);
        }
    }

    protected addHandledMessage(messageId: string) {
        this.handledMessages.add(messageId);
        setTimeout(() => {
            this.handledMessages.delete(messageId);
        }, 3 * 60 * 1000);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected preHandleMessage(_: E): void {}

    protected abstract parseMessage(event: E): ParsedMessage<M> | null;

    protected sendMessage(messageId: string, text: string, done: boolean = false): void {
        if (this.processingMessages.has(messageId)) {
            this._sendMessage(this.processingMessages.get(messageId)!, text);
            if (done) {
                this.processingMessages.delete(messageId);
            }
        }
    }

    protected abstract _sendMessage(message: M, content: string): void;
}
