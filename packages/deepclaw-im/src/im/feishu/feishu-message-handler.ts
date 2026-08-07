import { IMMessageHandler, ParsedMessage } from "../im-message-handler";
import { LarkChannel, NormalizedMessage } from '@larksuiteoapi/node-sdk';
import { getLogger } from '@deepclaw/node-utils';

const logger = getLogger('FeishuMessageHandler');

export class FeishuMessageHandler extends IMMessageHandler<NormalizedMessage, NormalizedMessage> {
    private channel: LarkChannel;

    constructor(agentId: string, channel: LarkChannel) {
        super(agentId);
        this.channel = channel;
    }

    protected override parseMessage(event: NormalizedMessage): ParsedMessage<NormalizedMessage> {
        return {id: event.messageId, text: event.content?.trim() || '', body: event};
    }

    protected override _sendMessage(message: NormalizedMessage, text: string): void {
        void this.channel.send(
            message.chatId,
            { text },
            { replyTo: message.messageId },
        ).catch(error => {
            logger.error(`send message to ${message.chatId} failed.`, error);
        });
    }
}
