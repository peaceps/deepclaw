import {DWClient, DWClientDownStream, EventAck, TOPIC_ROBOT} from 'dingtalk-stream';
import { IM } from '../im-definitions';
import { FlushAgent } from '@deepclaw/core';

const onBotMessage = (agent: FlushAgent) => async (event: DWClientDownStream) => {
    let message = JSON.parse(event.data);
    let content = (message?.text?.content || '').trim();
    let webhook = message?.sessionWebhook || '';

    const response = await agent.invoke(content);
    void fetch(webhook, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            msgtype: 'text',
            text: {content: response},
            at: {atUserIds: [message?.senderStaffId || '']}
        })
    });

    return {status: EventAck.SUCCESS, message: 'OK'}; // message 属性可以是任意字符串；
}

function connect(appId: string, secret: string, agent: FlushAgent): { disconnect: () => void } {
    const client = new DWClient({
      clientId: appId,
      clientSecret: secret,
    });
    client.registerCallbackListener(TOPIC_ROBOT, onBotMessage(agent)).connect();
    return {
        disconnect: () => client.disconnect()
    };
}

export const dingTalk: IM = {
    connect,
}
