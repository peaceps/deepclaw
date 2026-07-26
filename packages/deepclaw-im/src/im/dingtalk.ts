import {DWClient, DWClientDownStream, EventAck, TOPIC_ROBOT} from 'dingtalk-stream';
import { IM, IMHooks } from '../im-definitions';
import { AgentInteractionEventPayload } from '@deepclaw/core';
import { i18nInstance } from '@deepclaw/i18n';
import {stringifiedInteractionEvent, parseStringifiedAnswer} from '../stringified-event';
import { LoopInitializer } from '@deepclaw/agent';
import { getLogger } from '@deepclaw/node-utils';

type EndPoint = {
    sessionWebhook: string;
    senderStaffId?: string;
}

const logger = getLogger('dingtalk');
const handledMessages = new Set<string>();

// TODO multi session control
const onBotMessage = (client: DWClient, agentId: string, hooks?: IMHooks) => {
    const endPoint = {sessionWebhook: '', senderStaffId: ''};
    let interactionResolver: Function | null = null;
    let sequentialInteraction: Promise<void> = Promise.resolve();

    const loop = LoopInitializer.getLoop('agent', agentId, '', {
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

            if (hooks && hooks.onReceive) {
                try {
                    const preHookResult = hooks.onReceive();
                    if (preHookResult.message) {
                        sendMessage(endPoint, preHookResult.message);
                    }
                    if (preHookResult.stop) {
                        return;
                    }
                } catch (e) {
                    const msg = i18nInstance.t('im.error');
                    logger.warn(`${msg}: ${e}`);
                    sendMessage(endPoint, msg);
                    return;
                }
            }

            const content = (message?.text?.content || '').trim();
            if (interactionResolver) {
                const resolver = interactionResolver;
                interactionResolver = null;
                resolver(content);
                return;
            }
            
            sendMessage(endPoint, i18nInstance.t('im.wait'));

            try {
                await hooks?.waitReady?.();
            } catch (e) {
                const msg = i18nInstance.t('im.error');
                logger.error(`${msg}: ${e}`);
                sendMessage(endPoint, msg);
                return;
            }
            
            sequentialInteraction = sequentialInteraction
                .then(() => hooks?.onInvoke?.(content))
                .then(() => loop.invoke(content, { browserId: '' }))
                .then(res => {
                    sendMessage(endPoint, res.text);
                    hooks?.postSend?.(res.text);
                })
                .catch((e) => {
                    const error = `${i18nInstance.t('im.error')}: ${e?.message}`
                    sendMessage(endPoint, error);
                    hooks?.postSend?.(error);
                });
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

function connect(appId: string, secret: string, agentId: string, hooks?: IMHooks): { disconnect: () => void } {
    const client = new DWClient({
      clientId: appId,
      clientSecret: secret,
    });
    client.registerCallbackListener(TOPIC_ROBOT, onBotMessage(client, agentId, hooks)).connect();
    return {
        disconnect: () => client.disconnect()
    };
}

export const dingTalk: IM = {
    connect,
}
