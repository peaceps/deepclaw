import {DWClient, DWClientDownStream, EventAck} from 'dingtalk-stream';
import { getLogger } from '@deepclaw/node-utils';
import { i18nInstance } from '@deepclaw/i18n';
import { imageKeyExtension, type ImageContent } from '@deepclaw/core';
import { IMMessageHandler, ParsedMessage } from "../im-message-handler";
import { imageBytes } from '../../utils/image-bytes';
import { imageMediaType } from '../../utils/image-media-type';
import { extractMarkdownImages, replaceMarkdownImages } from '../../utils/markdown-images';

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
        if (extractMarkdownImages(content).images.length === 0) {
            this.post(endPoint, content);
            return;
        }
        void this.postWithImages(endPoint, content);
    }

    private post(endPoint: EndPoint, text: string): void {
        void fetch(endPoint.sessionWebhook, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                msgtype: 'markdown',
                // dingtalk shows the title, not the text, in the push notification
                markdown: {title: text.split('\n', 1)[0]!.slice(0, 20), text},
                at: {atUserIds: [endPoint.senderStaffId || '']}
            })
        }).catch(error => {
            logger.error({err: error}, `send message to ${endPoint.sessionWebhook} failed.`);
        });
    }

    /** A session webhook carries markdown only, so every picture has to become a url it can name. */
    private async postWithImages(endPoint: EndPoint, content: string): Promise<void> {
        let missed = 0;
        const text = await replaceMarkdownImages(content, async url => {
            const mediaId = await this.imageUrl(url);
            if (!mediaId) missed++;
            return mediaId;
        });
        if (missed === 0) {
            this.post(endPoint, text);
            return;
        }
        const note = i18nInstance.t('im.imagesNotSent');
        this.post(endPoint, text ? `${text}\n\n${note}` : note);
    }

    /** A linked picture is left for the client to fetch, bytes of ours go to the media store first. */
    private async imageUrl(url: string): Promise<string | null> {
        if (url.startsWith('http')) {
            return url;
        }
        const bytes = imageBytes(url);
        if (!bytes) {
            logger.error(`image not sent, unsupported url: ${url.slice(0, 64)}`);
            return null;
        }
        return this.uploadImage(bytes);
    }

    /**
     * Media the robot uploads itself is what a dingtalk client can show, and its id stands
     * in for a url in markdown. Only clients of the same organization can read it.
     */
    private async uploadImage(bytes: Buffer): Promise<string | null> {
        try {
            const mediaType = imageMediaType(bytes);
            const form = new FormData();
            form.append('media',
                new Blob([new Uint8Array(bytes)], {type: mediaType}),
                `image.${imageKeyExtension(mediaType)}`);
            const accessToken = await this.client.getAccessToken();
            const res = await fetch(
                `https://oapi.dingtalk.com/media/upload?access_token=${accessToken}&type=image`,
                {method: 'POST', body: form},
            );
            const data = await res.json() as {media_id?: string; errmsg?: string};
            if (!data.media_id) {
                logger.error(`upload image API returned ${res.status}: ${data.errmsg || 'no media_id'}`);
                return null;
            }
            return data.media_id;
        } catch (e) {
            logger.error(`upload image failed: ${e}`);
            return null;
        }
    }
}
