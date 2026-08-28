import {AGENTS_DIR, CHAT_FILE, PROJECT_DIR, SessionService} from '@deepclaw/agent';
import { ChatMessage, splitLoopId } from '@deepclaw/core';
import { globalize } from '@deepclaw/utils';
import { FileUtils, getLogger } from '@deepclaw/node-utils';
import { storeImages } from './image-refs';

/**
 * How many messages a page of a chat carries. Enough to fill a tall panel and leave room above the
 * fold, since a reader who reaches the top of a page waits there for the next one; and enough that
 * a conversation read back, which is read off the disk whole for every page of it, is asked fewer
 * times for the same walk through it.
 */
export const PAGE_SIZE = 30;
const EMPTY_RANGE: [number, number] = [0, 0];
/**
 * What the caches and the file are looked up by. A conversation that was closed is read under a key
 * of its own so that it never shares a page or an index with the one being talked in.
 */
const ARCHIVED_KEY_SEPARATOR = '#';

/**
 * How many conversations are held in memory at once.
 *
 * Held here rather than counted by the gateway along with its loops, because a loop is not what
 * puts a conversation in this store: a chat is read into memory by being opened, and opening one
 * builds no loop at all. A walk down the agent list would otherwise leave every transcript it
 * passed behind it, for as long as the program runs.
 *
 * Twelve for the same reason the loop store keeps twelve -- it is how many agents and projects
 * anybody goes back and forth between -- and the cost of going over is the same too: the next word
 * said in the conversation that was let go of reads it back off the disk first.
 *
 * Soft, as that one is: a conversation holding something that is not on the disk yet is kept
 * whatever its age.
 */
const MAX_LIVE_CHATS = 12;

/**
 * What one conversation has to reach before it is worth a word in the log, in messages and in bytes
 * of the file. The whole of a chat is read and parsed to show the last page of it, so a big one is
 * paid for on every cold open -- and being let go of makes cold opens the common case rather than
 * the once-per-process one.
 *
 * Nothing is done about it here. This is the line past which somebody should be told, so that the
 * day a conversation grows into a problem is a day it is known rather than guessed at.
 */
const BIG_CHAT_MESSAGES = 20000;
const BIG_CHAT_BYTES = 8 * 1024 * 1024;

const logger = getLogger('UIChatService');

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

    /**
     * The message as it stands afterwards, or nothing where this conversation holds no such message.
     *
     * A message that is already written is written again in place, which is the whole file: what
     * every other write goes through can only add to the end of it. Rare, and not as rare as it
     * sounds -- the empty message an answer is opened with is written by whatever is said next,
     * long before the answer that fills it comes back.
     */
    public static replaceMessage(loopId: string, id: string, text: string): ChatMessage | undefined {
        this.ensureMessageLoaded(loopId);
        const messages = this.messageStore.get(loopId)!;
        const index = messages.findIndex(m => m.id === id);
        const message = messages[index];
        if (!message) {
            return undefined;
        }
        message.content = text;
        if (index < (this.persistedIndex.get(loopId) ?? 0)) {
            this.rewriteMessages(loopId);
        } else {
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

    /**
     * Forgets every conversation of a project, for where the folder those are written in moves out
     * from under them.
     *
     * By the project rather than by the loop, because neither the loops nor the agents are the whole
     * of what is held here: a project can be talked to by more than one agent, and a conversation
     * that was only ever read is held here with no loop held anywhere. What such a chat holds is the
     * dangerous half -- the count of what has already been written -- and left behind it would have
     * the next message land in the middle of a file that has moved away, taking a new one with a
     * hole in it where the conversation used to be.
     */
    public static forgetProject(projectId: string): void {
        const held = new Set([
            ...this.messageStore.keys(), ...this.persistedIndex.keys(), ...this.messageIndexCache.keys()
        ]);
        for (const chatKey of held) {
            if (splitLoopId(this.splitChatKey(chatKey).loopId).projectId === projectId) {
                this.forget(chatKey);
            }
        }
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
        this.freshest(chatKey);
        this.evictIdleChats(chatKey);
    }

    /**
     * Moves a conversation to the end of the store, the end being where the one just used belongs.
     * Insertion order is the whole of the recency kept here: a map holds a key where it was first
     * put, so a key taken out and put back is a key at the end, and the front is the one nobody has
     * asked for in the longest.
     */
    private static freshest(chatKey: string): void {
        const messages = this.messageStore.get(chatKey);
        if (!messages) {
            return;
        }
        this.messageStore.delete(chatKey);
        this.messageStore.set(chatKey, messages);
    }

    /**
     * Lets go of the conversations nobody has read or written in for the longest, down to the limit.
     * Nothing is lost by it: the file is what a conversation is, and this store is only the copy
     * that saves reading it again.
     *
     * Two are never let go of. One is what the disk cannot give back: a conversation holding a
     * message that is not written yet -- the empty one an answer is opened with -- would come back
     * without it, and the answer that fills it would then have no message to land on. The other is
     * the conversation being read or written this very moment, named here rather than left to its
     * place at the end of the queue: where every one ahead of it is being kept, the walk reaches
     * the end, and the caller would be handed a conversation dropped out from under it between
     * being read in and being used.
     */
    private static evictIdleChats(inUse: string): void {
        for (const chatKey of this.messageStore.keys()) {
            if (this.messageStore.size <= MAX_LIVE_CHATS) {
                return;
            }
            if (chatKey === inUse || this.holdsUnwritten(chatKey)) {
                continue;
            }
            this.forget(chatKey);
        }
    }

    private static holdsUnwritten(chatKey: string): boolean {
        const held = this.messageStore.get(chatKey)?.length ?? 0;
        return held > (this.persistedIndex.get(chatKey) ?? 0);
    }

    private static loadPersistedMessages(chatKey: string): void {
        const {loopId, sessionId} = this.splitChatKey(chatKey);
        if (!sessionId) {
            this.migrateLegacyChatFile(loopId);
        }
        const chatFilePath = this.getChatFile(chatKey);
        // The empty conversation and the count of nothing written are put down together, before the
        // read that is allowed to fail. A read that does fail leaves whatever it managed, and half
        // of this pair is the dangerous half: a count left over from the conversation that was here
        // before names a place in a file that was never read, and the messages said next would be
        // skipped over from the front and never written at all.
        this.messageStore.set(chatKey, []);
        this.persistedIndex.set(chatKey, 0);
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
            this.reportSize(chatKey, lines.length, file);
        } catch {
            // TODO PASS
        }
    }

    /**
     * Says so where a conversation has grown big enough that reading it back is worth noticing.
     * Nothing here reads a part of a file, so the whole of it is parsed to show the last page of it,
     * and every time it is opened cold at that.
     */
    private static reportSize(chatKey: string, messages: number, file: string): void {
        const bytes = Buffer.byteLength(file, 'utf8');
        if (messages <= BIG_CHAT_MESSAGES && bytes <= BIG_CHAT_BYTES) {
            return;
        }
        logger.warn(
            `Chat ${chatKey} has grown to ${messages} messages and ${bytes} bytes, `
            + 'all of which is read and parsed every time it is opened.'
        );
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

    /**
     * Writes the file again out of what has already been written to it, for a change to a line that
     * is in there. An append asked to do this writes nothing at all -- the increment it takes is
     * everything past the last line, and the change is behind that -- so the message would be
     * changed in memory and left as it was on the disk. That showed as nothing while the memory copy
     * outlived the process, and shows as the change never having happened the moment a conversation
     * is let go of and read back.
     *
     * Only as far as the file already goes. Anything past that is not written yet for a reason: the
     * empty message an answer is opened with is in there, and a rewrite that took it along would
     * leave it in the conversation for good.
     */
    private static rewriteMessages(chatKey: string): void {
        const messages = this.messageStore.get(chatKey) ?? [];
        const written = messages.slice(0, this.persistedIndex.get(chatKey) ?? 0);
        const content = written.map(m => JSON.stringify(m)).join('\n') + (written.length > 0 ? '\n' : '');
        try {
            FileUtils.writeFile(this.getChatFile(chatKey), content);
        } catch (error) {
            // An append that fails is a message missing from the file, which the conversation read
            // back shows as such. This one fails into the shape of the bug it is here to fix: the
            // old line is still on the disk while the new one is on the page, and the two agree
            // again -- on the old one -- the day the conversation is read back.
            logger.warn(`Rewriting the chat file of ${chatKey} failed, leaving it as it was: ${error}`);
        }
    }

}

export const UIChatService = globalize('UIChatService', UIChatServiceImpl);
