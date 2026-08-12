import {AGENTS_DIR, CHAT_FILE, PROJECT_DIR} from '@deepclaw/agent';
import { ChatMessage, splitLoopId } from '@deepclaw/core';
import { globalize } from '@deepclaw/utils';
import { FileUtils } from '@deepclaw/node-utils';
import { storeImages } from './image-refs';

const PAGE_SIZE = 10;
const EMPTY_RANGE: [number, number] = [0, 0];

// TODO FULL MEMORY
class UIChatServiceImpl {

    private static messageIndexCache: Map<string, Map<string, number>> = new Map();
    private static persistedIndex: Map<string, number> = new Map();
    private static messageStore: Map<string, ChatMessage[]> = new Map();

    public static addMessage(loopId: string, message: ChatMessage): void {
        this.ensureMessageLoaded(loopId);
        const messages = this.messageStore.get(loopId)!;
        message.images = storeImages(loopId, message.images);
        messages.push(message);
        // The empty message that is opened for an answer waits for its content, but a
        // message that carries nothing but images is already whole.
        if (message.content || message.images?.length) {
            this.saveMessages(loopId);
        }
    }

    public static replaceMessage(loopId: string, id: string, text: string): ChatMessage | undefined {
        this.ensureMessageLoaded(loopId);
        const messages = this.messageStore.get(loopId)!;
        const message = messages.find(m => m.id === id);
        if (message) {
            message.content = text;
            this.saveMessages(loopId);
        }
        return message;
    }

    public static getOlderMessages(loopId: string, endMessageId?: string): ChatMessage[] {
        const getRange = (msgLen: number): [number, number] => {
            if (!endMessageId) return [Math.max(0, msgLen - PAGE_SIZE), msgLen];
            const end = this.getCachedIndex(loopId, endMessageId);
            // Callers merge the result into what they already hold, so an unresolvable
            // cursor has to yield nothing rather than a page they may already have.
            if (end === undefined) return EMPTY_RANGE;
            return [Math.max(0, end - PAGE_SIZE), end];
        }
        return this.getMessages(loopId, getRange);
    }

    public static getNewerMessages(loopId: string, startMessageId?: string): ChatMessage[] {
        const getRange = (msgLen: number): [number, number] => {
            if (!startMessageId) return [0, msgLen];
            const index = this.getCachedIndex(loopId, startMessageId);
            if (index === undefined) return EMPTY_RANGE;
            return [index + 1, msgLen];
        }
        return this.getMessages(loopId, getRange);
    }

    private static getMessages(loopId: string, getRange: (msgLen: number) => [number, number]): ChatMessage[] {
        this.ensureMessageLoaded(loopId);
        const messages = this.messageStore.get(loopId);
        if (!messages) {
            return [];
        }
        const [start, end] = getRange(messages.length);
        const page = messages.slice(start, end);
        if (page.length > 0) {
            this.addCachedIndex(loopId, page[0]!.id, start);
            this.addCachedIndex(loopId, page[page.length - 1]!.id, end - 1);
        }
        return page;
    }

    private static addCachedIndex(loopId: string, lastMessageId: string, index: number): void {
        if (!this.messageIndexCache.has(loopId)) {
            this.messageIndexCache.set(loopId, new Map());
        }
        this.messageIndexCache.get(loopId)!.set(lastMessageId, index);
    }

    private static getCachedIndex(loopId: string, messageId: string): number | undefined {
        const cached = this.messageIndexCache.get(loopId)?.get(messageId);
        if (cached !== undefined) return cached;
        const arr = this.messageStore.get(loopId);
        const idx = arr?.findIndex(m => m.id === messageId);
        return idx !== undefined && idx > -1 ? idx : undefined;
    }

    private static ensureMessageLoaded(loopId: string) {
        if (!this.messageStore.has(loopId)) {
            this.loadPersistedMessages(loopId);
        }
    }

    private static loadPersistedMessages(loopId: string): void {
        const chatFilePath = this.getChatFile(loopId);
        this.messageStore.set(loopId, []);
        try {
            const file = FileUtils.readFile(chatFilePath);
            const lines = file.split('\n').filter(line => !!line.trim());
            for (const line of lines) {
                try {
                    const message: ChatMessage = JSON.parse(line);
                    this.messageStore.get(loopId)!.push(message);
                } catch {
                    continue;
                }
            }
            this.persistedIndex.set(loopId, this.messageStore.get(loopId)!.length);
        } catch {
            // TODO PASS
        }
    }

    private static getChatFile(loopId: string): string {
        const {agentId, projectId} = splitLoopId(loopId);
        if (projectId) {
            return `${PROJECT_DIR}/${projectId}/${CHAT_FILE}`;
        } else {
            return `${AGENTS_DIR}/${agentId}/${CHAT_FILE}`;
        }
    }

    private static saveMessages(loopId: string): void {
        const messages = this.messageStore.get(loopId)! || [];
        const chatFilePath = this.getChatFile(loopId);
        const from = this.persistedIndex.get(loopId) ?? 0;
        const newMessages = messages.slice(from);
        this.persistedIndex.set(loopId, messages.length);
        const content = newMessages.map(m => JSON.stringify(m)).join('\n') + (newMessages.length > 0 ? '\n' : '');
        try {
            FileUtils.appendFile(chatFilePath, content);
        } catch {
            // TODO pass
        }
    }

}

export const UIChatService = globalize('UIChatService', UIChatServiceImpl);
