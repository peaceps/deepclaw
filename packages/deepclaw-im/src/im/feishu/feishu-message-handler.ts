import { IMMessageHandler, ParsedMessage } from "../im-message-handler";
import { LarkChannel, NormalizedMessage } from '@larksuiteoapi/node-sdk';
import { type ImageContent } from '@deepclaw/core';
import { extractMarkdownImages } from '../../utils/markdown-images';
import { imageBytes } from '../../utils/image-bytes';
import { imageMediaType } from '../../utils/image-media-type';
import { i18nInstance } from '@deepclaw/i18n';
import { getLogger } from '@deepclaw/node-utils';

const logger = getLogger('FeishuMessageHandler');

type MessageContent = Parameters<LarkChannel['send']>[1];

export class FeishuMessageHandler extends IMMessageHandler<NormalizedMessage, NormalizedMessage> {
    private channel: LarkChannel;

    constructor(agentId: string, channel: LarkChannel) {
        super(agentId);
        this.channel = channel;
    }

    protected override parseMessage(event: NormalizedMessage): ParsedMessage<NormalizedMessage> {
        // an inbound picture reaches the content as ![image](<image key>), its bytes come from fetchImages
        const {text} = extractMarkdownImages(event.content || '');
        return {
            id: event.messageId,
            text,
            body: event,
            fetchImages: () => this.extractImages(event),
        };
    }

    private async extractImages(event: NormalizedMessage): Promise<ImageContent[] | undefined> {
        const imageResources = event.resources?.filter(r => r.type === 'image') ?? [];
        if (imageResources.length === 0) return undefined;

        const images: ImageContent[] = [];
        for (const resource of imageResources) {
            try {
                const buffer = await this.downloadImage(event.messageId, resource.fileKey);
                const mediaType = imageMediaType(buffer);
                images.push({
                    url: `data:${mediaType};base64,${buffer.toString('base64')}`,
                    mediaType,
                });
            } catch (e) {
                logger.error(`download image resource ${resource.fileKey} failed: ${e}`);
            }
        }
        return images.length > 0 ? images : undefined;
    }

    /**
     * A picture someone sent can only be read through the message that carries it.
     * channel.downloadResource asks im.v1.image.get, which serves what the bot uploaded itself.
     */
    private async downloadImage(messageId: string, fileKey: string): Promise<Buffer> {
        const resource = await this.channel.rawClient.im.v1.messageResource.get({
            path: {message_id: messageId, file_key: fileKey},
            params: {type: 'image'},
        });
        const chunks: Buffer[] = [];
        for await (const chunk of resource.getReadableStream()) {
            chunks.push(Buffer.from(chunk as Buffer));
        }
        return Buffer.concat(chunks);
    }

    protected override _sendMessage(message: NormalizedMessage, text: string): void {
        const {text: textPart, images} = extractMarkdownImages(text);
        if (images.length === 0) {
            this.send(message, {markdown: text});
            return;
        }
        if (textPart) {
            this.send(message, {markdown: textPart});
        }
        void this.sendImages(message, images.map(image => image.url));
    }

    /** A picture nobody can see is worth a word, otherwise the answer quietly misses it. */
    private async sendImages(message: NormalizedMessage, urls: string[]): Promise<void> {
        let sent = 0;
        for (const url of urls) {
            if (await this.sendImage(message, url)) sent++;
        }
        if (sent < urls.length) {
            this.send(message, {markdown: i18nInstance.t('im.imagesNotSent')});
        }
    }

    private send(message: NormalizedMessage, content: MessageContent): void {
        void this.trySend(message, content);
    }

    private async trySend(message: NormalizedMessage, content: MessageContent): Promise<boolean> {
        try {
            await this.channel.send(message.chatId, content, {replyTo: message.messageId});
            return true;
        } catch (error) {
            // The channel only names the step it failed at, the reason sits in the cause it carries.
            logger.error({err: error}, `send message to ${message.chatId} failed.`);
            return false;
        }
    }

    /** The channel fetches a linked image itself, only bytes of our own have to be decoded. */
    private sendImage(message: NormalizedMessage, url: string): Promise<boolean> {
        const source = url.startsWith('http') ? url : imageBytes(url);
        if (!source) {
            logger.error(`image not sent to ${message.chatId}, unsupported url: ${url.slice(0, 64)}`);
            return Promise.resolve(false);
        }
        return this.trySend(message, {image: {source}});
    }
}
