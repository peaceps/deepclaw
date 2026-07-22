import {DWClient, DWClientDownStream, EventAck, TOPIC_ROBOT} from 'dingtalk-stream';
import { IM } from '../im-definitions';
import { AgentInteractionEventPayload } from '@deepclaw/core';
import { i18nInstance } from '@deepclaw/i18n';
import {stringifiedInteractionEvent, parseStringifiedAnswer} from '../stringified-event';
import { LoopInitializer, AgentIdentityManager } from '@deepclaw/agent';

type EndPoint = {
    sessionWebhook: string;
    senderStaffId?: string;
}

const handledMessages = new Set<string>();

// TODO multi session control
const onBotMessage = (client: DWClient) => {
    const endPoint = {sessionWebhook: '', senderStaffId: ''};
    let interactionResolver: Function | null = null;
    let sequentialInteraction: Promise<void> = Promise.resolve();
    const agent = AgentIdentityManager.getAgents()[0]!;

    const loop = LoopInitializer.getLoop(agent.id, '', {
        onStreamText: () => {},
        onInteractionEvent: handleInteractionEvent,
        onInfoEvent: () => Promise.resolve(),
    });

    async function handleInteractionEvent(event: AgentInteractionEventPayload): Promise<string> {
        sendMessage(endPoint, stringifiedInteractionEvent(event));
        return event.type === 'readonly' ? Promise.resolve('') : new Promise<string>((resolve) => {
            interactionResolver = resolve;
        }).then(async (answer: string) => {
            return await parseStringifiedAnswer(
                event,
                answer,
                c => sendMessage(endPoint, c),
                handleInteractionEvent
            );
        });
    }

    return async (event: DWClientDownStream) => {
        try {
            client.socketCallBackResponse(event.headers.messageId, {status: EventAck.SUCCESS, message: 'OK'});
        } catch(e) {
            console.error(`message ${event.headers.messageId} send response failed.`, e);
            handledMessages.add(event.headers.messageId);
            setTimeout(() => {
                handledMessages.delete(event.headers.messageId);
            }, 3 * 60 * 1000);
        }
        try {
            if (handledMessages.has(event.headers.messageId)) {
                return;
            }
            const message = JSON.parse(event.data);
            endPoint.sessionWebhook = message.sessionWebhook || endPoint.sessionWebhook;
            endPoint.senderStaffId = message.senderStaffId || endPoint.senderStaffId;
            const content = (message?.text?.content || '').trim();
            if (interactionResolver) {
                const resolver = interactionResolver;
                interactionResolver = null;
                resolver(content);
                return;
            }
            
            sendMessage(endPoint, i18nInstance.t('im.wait'));
            sequentialInteraction = sequentialInteraction.then(
                () => loop.invoke(content, { browserId: '' }).then(res => {
                    sendMessage(endPoint, res.text);
                }).catch(() => {
                    sendMessage(endPoint, i18nInstance.t('im.error'));
                })
            );
        } catch(e) {
            console.error(`message ${event.headers.messageId} processing error, simply ignore it.`, e);
        }
    }
}

function sendMessage(endPoint: EndPoint, content: string): void {
    if (!endPoint.sessionWebhook) {
        // TODO handle error
        console.info('DingTalk sessionWebhook is not set.');
        return;
    }
    void fetch(endPoint.sessionWebhook, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            msgtype: 'text',
            text: {content},
            at: {atUserIds: [endPoint.senderStaffId || '']}
        })
    }).catch(error => {
        // TODO handle error
        console.error(`send message to ${endPoint.sessionWebhook} failed.`, error);
    });
}

function connect(appId: string, secret: string): { disconnect: () => void } {
    const client = new DWClient({
      clientId: appId,
      clientSecret: secret,
    });
    client.registerCallbackListener(TOPIC_ROBOT, onBotMessage(client)).connect();
    return {
        disconnect: () => client.disconnect()
    };
}

export const dingTalk: IM = {
    connect,
}
