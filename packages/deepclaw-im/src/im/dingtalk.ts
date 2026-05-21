import {DWClient, DWClientDownStream, EventAck, TOPIC_ROBOT} from 'dingtalk-stream';
import { IM } from '../im-definitions';
import { FlushAgent } from '@deepclaw/core';

const onBotMessage = (client: DWClient, agent: FlushAgent) => async (event: DWClientDownStream) => {

    try {
        client.socketCallBackResponse(event.headers.messageId, {status: EventAck.SUCCESS, message: 'OK'});

        const message = JSON.parse(event.data);
        const content = (message?.text?.content || '').trim();
        sendMessage(message, '请稍侯');
        agent.invoke(content).then(res => {
            sendMessage(message, res);
        });
    } catch(e) {
        console.error('simply ignore', e);
    }
}

function sendMessage(message: any, content: string) {
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
