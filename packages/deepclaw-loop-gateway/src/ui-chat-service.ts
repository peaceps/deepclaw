import {AGENTS_DIR, CHAT_FILE, PROJECT_DIR, SessionService} from '@deepclaw/agent';
import { ChatMessage, splitLoopId } from '@deepclaw/core';
import { globalize } from '@deepclaw/utils';
import { FileUtils } from '@deepclaw/node-utils';
import { storeImages } from './image-refs';

const PAGE_SIZE = 10;
const EMPTY_RANGE: [number, number] = [0, 0];
/**
 * What the caches and the file are looked up by. A conversation that was closed is read under a key
 * of its own so that it never shares a page or an index with the one being talked in.
 */
const ARCHIVED_KEY_SEPARATOR = '#';

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

    /**
     * Reads back from the end, of the conversation being talked in or of one that was closed. The
     * paging is the same either way: a session that was closed is longer than a page just as often.
     *
     * What was closed is let go of again as soon as the page is out. One live conversation per loop
     * is a bounded thing to hold; one more for every conversation anybody ever opens is not, and a
     * transcript nobody is going to add to is no cheaper to keep than to read again.
     */
    public static getOlderMessages(
        loopId: string, endMessageId?: string, sessionId?: string
    ): ChatMessage[] {
        const chatKey = this.chatKey(loopId, sessionId);
        const getRange = (msgLen: number): [number, number] => {
            if (!endMessageId) return [Math.max(0, msgLen - PAGE_SIZE), msgLen];
            const end = this.getCachedIndex(chatKey, endMessageId);
            // Callers merge the result into what they already hold, so an unresolvable
            // cursor has to yield nothing rather than a page they may already have.
            if (end === undefined) return EMPTY_RANGE;
            return [Math.max(0, end - PAGE_SIZE), end];
        }
        try {
            return this.getMessages(chatKey, getRange);
        } finally {
            if (sessionId) {
                this.forget(chatKey);
            }
        }
    }

    /**
     * The message asked from comes back with the ones after it. A client holds the newest message
     * it saw, and the answer it was watching being written may have been finished long after it
     * stopped watching: asking only for what comes after would leave it with the half of it.
     */
    public static getNewerMessages(loopId: string, startMessageId?: string): ChatMessage[] {
        const getRange = (msgLen: number): [number, number] => {
            if (!startMessageId) return [0, msgLen];
            const index = this.getCachedIndex(loopId, startMessageId);
            if (index === undefined) return EMPTY_RANGE;
            return [index, msgLen];
        }
        return this.getMessages(loopId, getRange);
    }

    private static getMessages(chatKey: string, getRange: (msgLen: number) => [number, number]): ChatMessage[] {
        this.ensureMessageLoaded(chatKey);
        const messages = this.messageStore.get(chatKey);
        if (!messages) {
            return [];
        }
        const [start, end] = getRange(messages.length);
        const page = messages.slice(start, end);
        if (page.length > 0) {
            this.addCachedIndex(chatKey, page[0]!.id, start);
            this.addCachedIndex(chatKey, page[page.length - 1]!.id, end - 1);
        }
        return page;
    }

    /**
     * Forgets everything held about a conversation, named by its chat key. All three of these have
     * to go together: a store emptied while the persist index still counts the messages that were
     * in it would start writing from the middle of a file that is no longer there, and the messages
     * before that point would never be written at all.
     */
    public static forget(chatKey: string): void {
        this.messageStore.delete(chatKey);
        this.persistedIndex.delete(chatKey);
        this.messageIndexCache.delete(chatKey);
    }

    private static addCachedIndex(chatKey: string, lastMessageId: string, index: number): void {
        if (!this.messageIndexCache.has(chatKey)) {
            this.messageIndexCache.set(chatKey, new Map());
        }
        this.messageIndexCache.get(chatKey)!.set(lastMessageId, index);
    }

    private static getCachedIndex(chatKey: string, messageId: string): number | undefined {
        const cached = this.messageIndexCache.get(chatKey)?.get(messageId);
        if (cached !== undefined) return cached;
        const arr = this.messageStore.get(chatKey);
        const idx = arr?.findIndex(m => m.id === messageId);
        return idx !== undefined && idx > -1 ? idx : undefined;
    }

    private static ensureMessageLoaded(chatKey: string) {
        if (!this.messageStore.has(chatKey)) {
            this.loadPersistedMessages(chatKey);
        }
    }

    private static loadPersistedMessages(chatKey: string): void {
        const {loopId, sessionId} = this.splitChatKey(chatKey);
        if (!sessionId) {
            this.migrateLegacyChatFile(loopId);
        }
        const chatFilePath = this.getChatFile(chatKey);
        this.messageStore.set(chatKey, []);
        try {
            const file = FileUtils.readFile(chatFilePath);
            const lines = file.split('\n').filter(line => !!line.trim());
            for (const line of lines) {
                try {
                    const message: ChatMessage = JSON.parse(line);
                    this.messageStore.get(chatKey)!.push(message);
                } catch {
                    continue;
                }
            }
            this.persistedIndex.set(chatKey, this.messageStore.get(chatKey)!.length);
        } catch {
            // TODO PASS
        }
    }

    private static chatKey(loopId: string, sessionId?: string): string {
        return !sessionId ? loopId : `${loopId}${ARCHIVED_KEY_SEPARATOR}${sessionId}`;
    }

    private static splitChatKey(chatKey: string): {loopId: string, sessionId?: string} {
        const [loopId = '', sessionId] = chatKey.split(ARCHIVED_KEY_SEPARATOR);
        return {loopId, sessionId};
    }

    /**
     * The transcript lives in the session folder it is the transcript of, so that closing a
     * conversation carries the reading of it along with the history it came out of.
     *
     * A cron run is the exception: its session folder is thrown away with the run, and its log is
     * a conversation nobody opens. Left where it was rather than deleted along with the session.
     */
    private static getChatFile(chatKey: string): string {
        const {loopId, sessionId} = this.splitChatKey(chatKey);
        if (sessionId) {
            return `${SessionService.getArchivedSessionDir(loopId, sessionId)}/${CHAT_FILE}`;
        }
        const {role} = splitLoopId(loopId);
        if (role === 'cron') {
            return this.getLegacyChatFile(loopId);
        }
        return `${SessionService.getLoopSessionDir(loopId)}/${CHAT_FILE}`;
    }

    private static getLegacyChatFile(loopId: string): string {
        const {agentId, projectId} = splitLoopId(loopId);
        if (projectId) {
            return `${PROJECT_DIR}/${projectId}/${CHAT_FILE}`;
        } else {
            return `${AGENTS_DIR}/${agentId}/${CHAT_FILE}`;
        }
    }

    /**
     * The transcript used to be kept beside the session folder instead of inside it, from before a
     * conversation could be closed. One left out there would be read back under whichever session
     * came after it, so it is moved in the first time the log is opened, and before a conversation
     * is closed: archiving one that was still outside would hand it to the empty session next.
     */
    public static migrateLegacyChatFile(loopId: string): void {
        if (splitLoopId(loopId).role === 'cron') {
            return;
        }
        const chatFile = this.getChatFile(loopId);
        if (FileUtils.exists(chatFile)) {
            return;
        }
        FileUtils.movePath(this.getLegacyChatFile(loopId), chatFile);
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
