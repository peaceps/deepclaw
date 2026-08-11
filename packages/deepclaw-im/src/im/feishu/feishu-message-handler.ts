import { IMMessageHandler, ParsedMessage } from "../im-message-handler";
import { LarkChannel, NormalizedMessage } from '@larksuiteoapi/node-sdk';
import { imageRefKey, type ImageContent } from '@deepclaw/core';
import { extractMarkdownImages } from '../../utils/markdown-images';
import { imageMediaType } from '../../utils/image-media-type';
import { getLogger, ImageStore } from '@deepclaw/node-utils';

const logger = getLogger('FeishuMessageHandler');

const base64DataUrlRegex = /^data:[^,]*;base64,([\s\S]*)$/;

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
        images.forEach(image => this.sendImage(message, image.url));
    }

    private send(message: NormalizedMessage, content: MessageContent): void {
        void this.channel.send(message.chatId, content, {replyTo: message.messageId}).catch(error => {
            logger.error(`send message to ${message.chatId} failed.`, error);
        });
    }

    /** The channel fetches a linked image itself, only bytes of our own have to be decoded. */
    private sendImage(message: NormalizedMessage, url: string): void {
        const source = url.startsWith('http') ? url : this.imageBytes(url);
        if (!source) {
            logger.error(`image not sent to ${message.chatId}, unsupported url: ${url.slice(0, 64)}`);
            return;
        }
        this.send(message, {image: {source}});
    }

    private imageBytes(url: string): Buffer | null {
        const key = imageRefKey(url);
        if (key) {
            return ImageStore.read(key);
        }
        const base64 = base64DataUrlRegex.exec(url);
        return base64 ? Buffer.from(base64[1]!, 'base64') : null;
    }
}
