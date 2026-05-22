import {DWClient, DWClientDownStream, EventAck, TOPIC_ROBOT} from 'dingtalk-stream';
import { IM } from '../im-definitions';
import { FlushAgent } from '@deepclaw/core';
import { i18nInstance } from '@deepclaw/i18n';

const handledMessages = new Set<string>();

const onBotMessage = (client: DWClient, agent: FlushAgent) => async (event: DWClientDownStream) => {

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
        const content = (message?.text?.content || '').trim();
        sendMessage(message, i18nInstance.t('im.wait'));
        agent.invoke(content).then(res => {
            sendMessage(message, res);
        }).catch(() => {
            sendMessage(message, i18nInstance.t('im.error'));
        });
    } catch(e) {
        console.error(`message ${event.headers.messageId} processing error, simply ignore it.`, e);
    }
}

function sendMessage(message: {sessionWebhook: string, senderStaffId: string}, content: string) {
    void fetch(message?.sessionWebhook || '', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            msgtype: 'text',
            text: {content},
            at: {atUserIds: [message?.senderStaffId || '']}
        })
    });
}

function connect(appId: string, secret: string, agent: FlushAgent): { disconnect: () => void } {
    const client = new DWClient({
      clientId: appId,
      clientSecret: secret,
    });
    client.registerCallbackListener(TOPIC_ROBOT, onBotMessage(client, agent)).connect();
    return {
        disconnect: () => client.disconnect()
    };
}

export const dingTalk: IM = {
    connect,
}
