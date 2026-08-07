import {DWClient, DWClientDownStream, TOPIC_ROBOT} from 'dingtalk-stream';
import { IM } from '../../utils/im-definitions';
import { DingtalkMessageHandler } from './dingtalk-message-handler';
import { getLogger } from '@deepclaw/node-utils';

const logger = getLogger('DingtalkEngine');

async function connect(appId: string, secret: string, agentId: string): Promise<{ disconnect: () => void }> {
    const client = new DWClient({
      clientId: appId,
      clientSecret: secret,
    });
    const handler = new DingtalkMessageHandler(agentId, client);
    const onMessage = (msg: DWClientDownStream) => handler.onMessage(msg);
    await client.registerCallbackListener(TOPIC_ROBOT, onMessage).connect();
    return {
        disconnect: () => {
            try {
                client.disconnect();
            } catch (e) {
                logger.error(`disconnect dingtalk client failed: ${e}`);
            }
        }
    };
}

export const dingTalk: IM = {
    connect,
}
