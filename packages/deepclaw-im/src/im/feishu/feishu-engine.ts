import { IM } from "../../utils/im-definitions";
import { createLarkChannel, NormalizedMessage } from '@larksuiteoapi/node-sdk';
import { FeishuMessageHandler } from './feishu-message-handler';
import { getLogger } from '@deepclaw/node-utils';

const logger = getLogger('FeishuEngine');

export const feishu: IM = {
    connect: async (appId: string, appSecret: string, agentId) => {
        const channel = createLarkChannel({ appId, appSecret });
        const handler = new FeishuMessageHandler(agentId, channel);
        channel.on('message', (msg: NormalizedMessage) => handler.onMessage(msg));
        await channel.connect();

        return {
            disconnect: () => {
                void channel.disconnect().catch(error => {
                    logger.error('disconnect feishu channel failed.', error);
                });
            }
        }
    }
}
