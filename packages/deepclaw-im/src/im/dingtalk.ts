import {DWClient, DWClientDownStream, EventAck, TOPIC_ROBOT} from 'dingtalk-stream';
import { IM } from '../im-definitions';
import { AgentInteractionEvent, FlushAgentConstructor } from '@deepclaw/core';
import { i18nInstance } from '@deepclaw/i18n';
import {stringifiedInteractionEvent, parseStringifiedAnswer} from '../stringified-event.js';

type EndPoint = {
    sessionWebhook: string;
    senderStaffId?: string;
}

const handledMessages = new Set<string>();

const onBotMessage = (client: DWClient, agentClass: FlushAgentConstructor) => {
    const endPoint = {sessionWebhook: '', senderStaffId: ''};
    let interactionResolver: Function | null = null;

    const agent = new agentClass({
        onStreamText: () => {},
        onToolText: () => {},
        onInteractionEvent: handleInteractionEvent,
    });

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
            agent.invoke(content).then(res => {
                sendMessage(endPoint, res);
            }).catch(() => {
                sendMessage(endPoint, i18nInstance.t('im.error'));
            });
        } catch(e) {
            console.error(`message ${event.headers.messageId} processing error, simply ignore it.`, e);
        }
    }
}

function sendMessage(endPoint: EndPoint, content: string) {
    void fetch(endPoint.sessionWebhook || '', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            msgtype: 'text',
            text: {content},
            at: {atUserIds: [endPoint.senderStaffId || '']}
        })
    });
}

function connect(appId: string, secret: string, agentClass: FlushAgentConstructor): { disconnect: () => void } {
    const client = new DWClient({
      clientId: appId,
      clientSecret: secret,
    });
    client.registerCallbackListener(TOPIC_ROBOT, onBotMessage(client, agentClass)).connect();
    return {
        disconnect: () => client.disconnect()
    };
}

export const dingTalk: IM = {
    connect,
}
