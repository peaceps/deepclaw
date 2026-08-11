import {DWClient, DWClientDownStream, EventAck} from 'dingtalk-stream';
import { getLogger } from '@deepclaw/node-utils';
import { type ImageContent } from '@deepclaw/core';
import { IMMessageHandler, ParsedMessage } from "../im-message-handler";
import { imageMediaType } from '../../utils/image-media-type';

const logger = getLogger('DingtalkMessageHandler');

type EndPoint = {
    sessionWebhook: string;
    senderStaffId?: string;
    robotCode?: string;
}

type RichTextItem = {
    type?: string;
    text?: string;
    downloadCode?: string;
};

type DingtalkMessage = {
    msgtype: string;
    text?: { content?: string };
    sessionWebhook?: string;
    senderStaffId?: string;
    robotCode?: string;
    content?: {
        downloadCode?: string;
        pictureDownloadCode?: string;
        richText?: RichTextItem[];
    };
};
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
            const message = JSON.parse(event.data) as DingtalkMessage;
            const endPoint: EndPoint = {
                sessionWebhook: message.sessionWebhook || "",
                senderStaffId: message.senderStaffId,
                robotCode: message.robotCode,
            };
            const text = (message.text?.content || this.richText(message)).trim();
            return {
                id: event.headers.messageId,
                text,
                body: endPoint,
                fetchImages: () => this.extractImages(message),
            };
        } catch(e) {
            logger.error(`parse message failed: ${e}`);
            return null;
        }
    }

    /** A rich text message carries its text in the same list as its pictures. */
    private richText(message: DingtalkMessage): string {
        return (message.content?.richText || []).map(item => item.text || '').join('');
    }

    private downloadCodes(message: DingtalkMessage): string[] {
        const content = message.content;
        if (!content) {
            return [];
        }
        if (message.msgtype === 'richText') {
            return (content.richText || [])
                .filter(item => item.type === 'picture' && item.downloadCode)
                .map(item => item.downloadCode!);
        }
        if (message.msgtype === 'picture') {
            const code = content.downloadCode || content.pictureDownloadCode;
            return code ? [code] : [];
        }
        return [];
    }

    private async extractImages(message: DingtalkMessage): Promise<ImageContent[] | undefined> {
        const downloadCodes = this.downloadCodes(message);
        if (downloadCodes.length === 0) {
            return undefined;
        }
        const images: ImageContent[] = [];
        for (const downloadCode of downloadCodes) {
            try {
                const image = await this.downloadImage(downloadCode, message.robotCode);
                if (image) images.push(image);
            } catch (e) {
                logger.error(`download image ${downloadCode} failed: ${e}`);
            }
        }
        return images.length > 0 ? images : undefined;
    }

    private async downloadImage(downloadCode: string, robotCode?: string): Promise<ImageContent | null> {
        if (!robotCode) {
            logger.warn('robotCode is missing, cannot download image');
            return null;
        }
        const accessToken = await this.client.getAccessToken();
        const res = await fetch('https://api.dingtalk.com/v1.0/robot/messageFiles/download', {
            method: 'POST',
            headers: {
                'x-acs-dingtalk-access-token': accessToken,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({robotCode, downloadCode}),
        });
        if (!res.ok) {
            const error = await res.text();
            logger.error(`download image API returned ${res.status}: ${error}`);
            return null;
        }
        const data = await res.json() as { downloadUrl?: string };
        if (!data.downloadUrl) {
            logger.error('download image API returned no downloadUrl');
            return null;
        }
        const imageRes = await fetch(data.downloadUrl);
        if (!imageRes.ok) {
            logger.error(`fetch image from downloadUrl returned ${imageRes.status}`);
            return null;
        }
        const buffer = Buffer.from(await imageRes.arrayBuffer());
        const mediaType = imageMediaType(buffer, imageRes.headers.get('content-type'));
        return {
            url: `data:${mediaType};base64,${buffer.toString('base64')}`,
            mediaType,
        };
    }

    protected override _sendMessage(endPoint: EndPoint, content: string): void {
        if (!endPoint.sessionWebhook) {
            logger.info('DingTalk sessionWebhook is not set.');
            return;
        }
        void fetch(endPoint.sessionWebhook, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                msgtype: 'markdown',
                // dingtalk shows the title, not the text, in the push notification
                markdown: {title: content.split('\n', 1)[0]!.slice(0, 20), text: content},
                at: {atUserIds: [endPoint.senderStaffId || '']}
            })
        }).catch(error => {
            logger.error(`send message to ${endPoint.sessionWebhook} failed.`, error);
        });
    }
}
