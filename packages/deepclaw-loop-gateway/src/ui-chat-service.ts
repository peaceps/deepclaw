import {AGENTS_DIR, CHAT_FILE, PROJECT_DIR} from '@deepclaw/agent';
import { ChatMessage } from '@deepclaw/core';
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
        if (messages.length - (this.persistedIndex.get(loopId) ?? 0) >= SAVE_THRESHOLD) {
            this.saveMessages(loopId);
        }
    }

    public static getMessages(loopId: string, lastMessageId?: string): ChatMessage[] {
        this.ensureMessageLoaded(loopId);
        const messages = this.messageStore.get(loopId)!;
        const end = !lastMessageId ? messages.length : (this.getCachedIndex(loopId, lastMessageId) ?? messages.length);
        const start = Math.max(0, end - PAGE_SIZE);
        const page = messages.slice(start, end);
        if (page.length > 0) {
            this.addCachedIndex(loopId, page[0]!.id, start);
        }
        return page;
    }

    private static addCachedIndex(loopId: string, lastMessageId: string, index: number): void {
        if (!this.messageIndexCache.has(loopId)) {
            this.messageIndexCache.set(loopId, new Map());
        }
        this.messageIndexCache.get(loopId)!.set(lastMessageId, index);
    }

    private static getCachedIndex(loopId: string, lastMessageId: string): number | undefined {
        const cached = this.messageIndexCache.get(loopId)?.get(lastMessageId);
        if (cached !== undefined) return cached;
        const arr = this.messageStore.get(loopId);
        const idx = arr?.findIndex(m => m.id === lastMessageId);
        return idx !== undefined && idx > -1 ? idx : undefined;
    }

    private static ensureMessageLoaded(loopId: string) {
        if (!this.messageStore.has(loopId)) {
            this.loadMessages(loopId);
        }
    }

    private static loadMessages(loopId: string): void {
        const chatFilePath = this.getChatFile(loopId);
        this.messageStore.set(loopId, []);
        try {
            const file = FileUtils.readFile(chatFilePath);
            for (const line of file.split('\n')) {
                if (line.trim() === '') continue;
                try {
                    const message: ChatMessage = JSON.parse(line);
                    this.messageStore.get(loopId)!.push(message);
                } catch {
                    continue;
                }
            }
        } catch {
            // TODO PASS
        }
    }

    private static getChatFile(loopId: string): string {
        const [agentId, projectId] = loopId.split('.');
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
