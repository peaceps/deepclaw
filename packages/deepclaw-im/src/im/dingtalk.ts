import {DWClient, DWClientDownStream, EventAck, TOPIC_ROBOT} from 'dingtalk-stream';
import { IM } from '../im-definitions';
import { AgentInteractionEvent, getLoopId, newMessage } from '@deepclaw/core';
import { i18nInstance } from '@deepclaw/i18n';
import {stringifiedInteractionEvent, parseStringifiedAnswer} from '../stringified-event';
import { LoopGateway } from '@deepclaw/loop-gateway';
import { isCurrentConfigValid } from '@deepclaw/config';
import { randomUUID } from 'node:crypto';

type EndPoint = {
    sessionWebhook: string;
    senderStaffId?: string;
}

const handledMessages = new Set<string>();

// TODO multi session control
const onBotMessage = (client: DWClient, agentId: string) => {
    const loopId = getLoopId('agent', agentId);
    const endPoint = {sessionWebhook: '', senderStaffId: ''};
    let interactionResolver: Function | null = null;
    let sequentialInteraction: Promise<void> = Promise.resolve();
    
    LoopGateway.initLoop(loopId);

    async function handleInteractionEvent(event: AgentInteractionEvent): Promise<string> {
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

    const onMessage = async (event: DWClientDownStream) => {
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

            if (!isCurrentConfigValid()) {
                sendMessage(endPoint, i18nInstance.t('im.invalidConfig'));
                return;
            }

            const content = (message?.text?.content || '').trim();
            if (interactionResolver) {
                const resolver = interactionResolver;
                interactionResolver = null;
                resolver(content);
                return;
            }

            if (LoopGateway.isLoopBusy(loopId)) {
                sendMessage(endPoint, i18nInstance.t('im.busy'));
                return;
            }

            LoopGateway.addMessage('', loopId, newMessage('user', agentId, `📱 ${content}`));
            
            sendMessage(endPoint, i18nInstance.t('im.wait'));
            
            sequentialInteraction = sequentialInteraction
                .then(() => {
                    const {busy} = LoopGateway.invoke(
                        {role: 'agent', agentId, projectId: ''},
                        {source: 'im', browserId: randomUUID()}, content,
                        {onInteractionEvent: handleInteractionEvent},
                        (text) => sendMessage(endPoint, text)
                    );
                    if (busy) {
                        sendMessage(endPoint, i18nInstance.t('im.busy'));
                        return;
                    }
                })
                .catch((e) => {
                    const error = `${i18nInstance.t('im.error')}: ${e?.message}`
                    sendMessage(endPoint, error);
                });
        } catch(e) {
            console.error(`message ${event.headers.messageId} processing error, simply ignore it.`, e);
        }
    }

    return {onMessage};
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

function connect(appId: string, secret: string, agentId: string): { disconnect: () => void } {
    const client = new DWClient({
      clientId: appId,
      clientSecret: secret,
    });
    const {onMessage} = onBotMessage(client, agentId);
    client.registerCallbackListener(TOPIC_ROBOT, onMessage).connect();
    return {
        disconnect: () => {
            client.disconnect();
        }
    };
}

export const dingTalk: IM = {
    connect,
}
