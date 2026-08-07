import {DWClient, DWClientDownStream, EventAck} from 'dingtalk-stream';
import { getLogger } from '@deepclaw/node-utils';
import { IMMessageHandler, ParsedMessage } from "../im-message-handler";

const logger = getLogger('DingtalkMessageHandler');

type EndPoint = {
    sessionWebhook: string;
    senderStaffId?: string;
}

export class DingtalkMessageHandler extends IMMessageHandler<DWClientDownStream, EndPoint> {
    private client: DWClient;

    constructor(agentId: string, client: DWClient) {
        super(agentId);
        this.client = client;
    }

    protected override preHandleMessage(event: DWClientDownStream): void {
        super.preHandleMessage(event);
        try {
            this.client.socketCallBackResponse(event.headers.messageId, {
                status: EventAck.SUCCESS, message: 'OK'
            });
        } catch(e) {
            logger.error(`message ${event.headers.messageId} send response failed: ${e}`);
        }
    }

    protected override parseMessage(event: DWClientDownStream): ParsedMessage<EndPoint> | null {
        try {
            const message = JSON.parse(event.data);
            return {
                id: event.headers.messageId,
                text: (message?.text?.content || '').trim(),
                body: {sessionWebhook: message.sessionWebhook, senderStaffId: message.senderStaffId}
            };
        } catch(e) {
            logger.error(`parse message failed: ${e}`);
            return null;
        }
    }

    protected override _sendMessage(endPoint: EndPoint, content: string): void {
        if (!endPoint.sessionWebhook) {
            // TODO handle error
            logger.info('DingTalk sessionWebhook is not set.');
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
            logger.error(`send message to ${endPoint.sessionWebhook} failed.`, error);
        });
    }
}
