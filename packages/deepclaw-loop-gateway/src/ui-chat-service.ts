import {AGENTS_DIR, CHAT_FILE, PROJECT_DIR} from '@deepclaw/agent';
import { ChatMessage, splitFlushAgentKey } from '@deepclaw/core';
import { globalize } from '@deepclaw/utils';
import { FileUtils } from '@deepclaw/node-utils';

const PAGE_SIZE = 10;
const SAVE_THRESHOLD = 5;

// TODO FULL MEMORY
class UIChatServiceImpl {

    private static messageIndexCache: Map<string, Map<string, number>> = new Map();
    private static persistedIndex: Map<string, number> = new Map();
    private static messageStore: Map<string, ChatMessage[]> = new Map();

    public static addMessage(loopId: string, message: ChatMessage): void{
        this.ensureMessageLoaded(loopId);
        const messages = this.messageStore.get(loopId)!;
        messages.push(message);
        if (messages.length < SAVE_THRESHOLD || messages.length - (this.persistedIndex.get(loopId) ?? 0) >= SAVE_THRESHOLD) {
            this.saveMessages(loopId);
        }
    }

    public static getOlderMessages(loopId: string, endMessageId?: string): ChatMessage[] {
        const getRange = (msgLen: number) => {
            const end = !endMessageId ? msgLen : (this.getCachedIndex(loopId, endMessageId) ?? msgLen);
            const start = Math.max(0, end - PAGE_SIZE);
            return [start, end] as [number, number];
        }
        return this.getMessages(loopId, getRange);
    }

    public static getNewerMessages(loopId: string, startMessageId?: string): ChatMessage[] {
        const getRange = (msgLen: number) => {
            const start = !startMessageId ? 0 : (this.getCachedIndex(loopId, startMessageId) ?? -1) + 1;
            const end = msgLen;
            return [start, end] as [number, number];
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
        const {agentId, projectId} = splitFlushAgentKey(loopId);
        if (projectId) {
            return `${PROJECT_DIR}/${projectId}/${CHAT_FILE}`;
        } else {
            return `${AGENTS_DIR}/${agentId}/${CHAT_FILE}`;
        }
    }

    public static saveMessages(loopId: string): void {
        const chatFilePath = this.getChatFile(loopId);
        const messages = this.messageStore.get(loopId) || [];
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
