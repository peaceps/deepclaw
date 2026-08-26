import { FileUtils } from "@deepclaw/node-utils";
import {
    AGENTS_DIR, ARCHIVED_DIR, CHAT_FILE, CRON_DIR, PROJECT_DIR, SESSION_DIR,
    SESSION_HISTORY_FILE, SESSION_METADATA_FILE, SUB_LOOP_DIR, TASK_LOOP_DIR
} from "../../paths";
import {
    isSpawnedLoop, LLMProtocol, LoopKind, LoopSessionStatus, OneLoopContext, SessionMetaData,
    SessionSummary, SpawnedLoop,
} from "../../definitions/definitions";
import { isExternalInterruptReason, isAgentStopReason, TokenUsage, splitLoopId, FlushAgentRole, addTokenUsage } from "@deepclaw/core";
import { getLogger } from "@deepclaw/node-utils";

const SAVE_THRESHOLD = 10;
const logger = getLogger('SessionService');
/**
 * What names a conversation that was closed: the moment it was closed at, to the millisecond. Both
 * what is offered in a list and what is accepted back from one are held to it.
 */
const SESSION_ID = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})$/;
/**
 * How much of the last thing an archived conversation said travels with the list of them. A list
 * shows two lines of it, and a run can end with a report of thirty thousand characters: sending the
 * whole of every one of them to draw two lines is a page that grows heavier with every conversation.
 */
const SUMMARY_TEXT_LIMIT = 200;
/**
 * How long a conversation's name is allowed to be. It is read at a glance off a list one line
 * wide, so what would not fit on that line is not a name but the question over again.
 */
const SESSION_NAME_LIMIT = 60;
/**
 * How short a name is allowed to be before more of the question is taken. The first sentence of a
 * question is often only the hello in front of it, and a conversation called `hi.` is one nobody
 * finds again.
 */
const SESSION_NAME_FLOOR = 8;
/**
 * As much of a line as ends where a sentence of it does. A latin full stop counts only where no
 * word carries on past it, or `session-service.ts` would end a sentence in the middle of a name.
 * Read with `matchAll`, which works on a clone of it: `test` or `exec` would carry the place it
 * stopped from one call into the next.
 */
const SENTENCE = /[\s\S]*?(?:[。！？；]|[.!?;](?=\s|$))/g;

export type MetaDataConfig = {
    sessionDir: string,
    agentId: string,
    projectId: string,
    loopId: string,
    loopKind: LoopKind,
    llmProtocol: LLMProtocol;
}

export class SessionService {

    private static sessionMeta: Map<string, SessionMetaData> = new Map();

    /**
     * A spawned loop is given a folder of its own outside the sessions that are kept, one per run:
     * it must never read the history of the loop that spawned it, and its own is thrown away with
     * the run rather than written into anybody's session.
     */
    public static getSessionDir(
        role: FlushAgentRole, agentId: string, projectId?: string, spawned?: SpawnedLoop
    ): string {
        if (spawned) {
            const folder = spawned.kind === 'task' ? TASK_LOOP_DIR : SUB_LOOP_DIR;
            return `${FileUtils.getTmpDir()}/${folder}/${spawned.runId}`;
        }
        if (role === 'agent') {
            return `${AGENTS_DIR}/${agentId}/${SESSION_DIR}`;
        } else if (role === 'cron') {
            return `${FileUtils.getTmpDir()}/${CRON_DIR}/${projectId}/${SESSION_DIR}`;
        } else if (role === 'project') {
            return `${PROJECT_DIR}/${projectId}/${SESSION_DIR}`;
        } else {
            throw new Error(`Unknown flush agent role: ${role}`);
        }
    }

    /** The folder the given loop is talking in. */
    public static getLoopSessionDir(loopId: string): string {
        const {role, agentId, projectId} = splitLoopId(loopId);
        return this.getSessionDir(role, agentId, projectId ?? '');
    }

    /**
     * The folder a conversation of this loop that was closed was moved to.
     *
     * The id arrives from a browser and is about to become a path. Nothing but a timestamp is a
     * session, and a name that is anything else is asking to be read somewhere it has no business
     * being: two dots would walk out of the agent's folder and into the live chat of another.
     */
    public static getArchivedSessionDir(loopId: string, sessionId: string): string {
        if (!SESSION_ID.test(sessionId)) {
            throw new Error(`Not a session id: ${sessionId}`);
        }
        return `${this.getArchivedDir(this.getLoopSessionDir(loopId))}/${sessionId}`;
    }

    /**
     * Where the conversations of this loop that were closed are kept. Derived from the folder being
     * talked in rather than named again per role: the two would drift apart, and a session archived
     * beside the wrong agent is a conversation nobody finds again.
     */
    private static getArchivedDir(sessionDir: string): string {
        const parent = sessionDir.lastIndexOf('/');
        if (parent < 0) {
            throw new Error(`Not a session folder: ${sessionDir}`);
        }
        return `${sessionDir.slice(0, parent)}/${ARCHIVED_DIR}`;
    }

    /** Called when a session folder is gone for good, otherwise its metadata would be kept forever. */
    public static dropSession(sessionDir: string): void {
        this.sessionMeta.delete(sessionDir);
    }

    /**
     * Closes the conversation of this loop by moving the whole session folder aside, so that the
     * next turn starts from an empty history. The chat log travels with it: what the user reads
     * back has to be the transcript of the very history the answers came out of.
     *
     * Answers with nothing when there was no conversation to close, and throws when there was one
     * and it did not move. Those two are worth telling apart by whoever asked: a caller that reads
     * a failure as an empty conversation goes on to empty the chat and build the loop again, and
     * the loop reads the very same history back off the disk it was never moved from. The user is
     * told they are starting over and the agent remembers everything.
     */
    public static archiveSession(loopId: string): string | undefined {
        const sessionDir = this.getLoopSessionDir(loopId);
        if (!FileUtils.exists(sessionDir) || this.isSessionEmpty(sessionDir)) {
            return undefined;
        }
        const sessionId = FileUtils.timestamp();
        const archived = `${this.getArchivedDir(sessionDir)}/${sessionId}`;
        // What the conversation ended as is read before the move and written after it. Stamped
        // where it stands, a move that then failed would leave the session still being talked in
        // marked as one that is over.
        const ended = this.endedMeta(sessionDir);
        if (!FileUtils.movePath(sessionDir, archived)) {
            throw new Error(`The session folder of ${loopId} went missing before it was archived.`);
        }
        this.dropSession(sessionDir);
        this.saveArchivedMeta(archived, ended);
        return sessionId;
    }

    /**
     * Whether closing this conversation would keep anything. A folder holding only what the loop
     * left lying around is nothing to read back, and filing one away per click would fill the list
     * with conversations that were never had.
     */
    private static isSessionEmpty(sessionDir: string): boolean {
        const meta = this.getMeta(sessionDir);
        if (meta && meta.runtime.turnCount > 0) {
            return false;
        }
        // A turn that never ran still leaves what the user typed and whatever the loop had already
        // been told, and losing either without a word is worse than keeping a short session around.
        return !FileUtils.exists(`${sessionDir}/${CHAT_FILE}`)
            && !FileUtils.exists(`${sessionDir}/${SESSION_HISTORY_FILE}`);
    }

    /** The metadata of this session as it stands, marked as over. Written nowhere yet. */
    private static endedMeta(sessionDir: string): SessionMetaData | undefined {
        const meta = this.getMeta(sessionDir);
        if (!meta) {
            return undefined;
        }
        const now = new Date().toISOString();
        return {
            ...meta,
            runtime: {...meta.runtime, endedAt: meta.runtime.endedAt ?? now, updatedAt: now},
        };
    }

    /** The conversation is already archived by now, so failing to stamp it is worth no more than a line. */
    private static saveArchivedMeta(archived: string, meta?: SessionMetaData): void {
        if (!meta) {
            return;
        }
        try {
            FileUtils.writeFile(
                `${archived}/${SESSION_METADATA_FILE}`, JSON.stringify(meta, null, 2)
            );
        } catch (error) {
            logger.warn(`Marking the archived session ${archived} as ended failed: ${error}`);
        }
    }

    /**
     * The conversations of this loop that were closed, the most recent one first.
     *
     * A folder is listed whether it has metadata or not. A conversation whose turn never ran has a
     * transcript and nothing else, and it is archived for exactly that reason: left off the list it
     * would be a folder holding what somebody typed that they can never open again. A folder whose
     * name is not a timestamp is not one of ours and is not offered as one, since it is a name that
     * would be refused the moment it was clicked.
     */
    public static listSessions(loopId: string): SessionSummary[] {
        const archivedDir = this.getArchivedDir(this.getLoopSessionDir(loopId));
        const sessions = FileUtils.listDirs(archivedDir)
            .filter(sessionId => SESSION_ID.test(sessionId))
            .map(sessionId => this.summarize(archivedDir, sessionId));
        return sessions.sort((a, b) => b.sessionId.localeCompare(a.sessionId));
    }

    private static summarize(archivedDir: string, sessionId: string): SessionSummary {
        const closedAt = this.sessionIdTime(sessionId);
        const empty: SessionSummary = {
            sessionId,
            startedAt: closedAt,
            updatedAt: closedAt,
            turnCount: 0,
            finalText: '',
            usage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
        };
        try {
            const file = FileUtils.readFile(`${archivedDir}/${sessionId}/${SESSION_METADATA_FILE}`);
            const {runtime} = JSON.parse(file) as SessionMetaData;
            return {
                sessionId,
                // Cut again on the way out: a name written by an older build answers to no limit
                // this one sets, and the list it is going to shows one line of it.
                name: runtime.name?.slice(0, SESSION_NAME_LIMIT),
                startedAt: runtime.startedAt ?? closedAt,
                updatedAt: runtime.updatedAt ?? closedAt,
                turnCount: runtime.turnCount ?? 0,
                finalText: (runtime.finalText ?? '').slice(0, SUMMARY_TEXT_LIMIT),
                usage: runtime.usage ?? empty.usage,
            };
        } catch {
            return empty;
        }
    }

    /**
     * The moment a session folder is named after: the name is a timestamp with its separators taken
     * out, and is the one thing known about a conversation whose metadata never made it to disk.
     * Only ever asked of a name that is one, which is the only kind that is listed.
     */
    private static sessionIdTime(sessionId: string): string {
        const [, year, month, day, hour, minute, second, ms] = SESSION_ID.exec(sessionId)!;
        return `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}Z`;
    }

    private static getMeta(sessionDir: string): SessionMetaData | null {
        const meta = this.sessionMeta.get(sessionDir);
        if (meta) return meta;
        const metaFilePath = `${sessionDir}/${SESSION_METADATA_FILE}`;
        try {
            const metaFile = FileUtils.readFile(metaFilePath);
            const meta = JSON.parse(metaFile) as SessionMetaData;
            this.sessionMeta.set(sessionDir, meta);
            return meta;
        } catch {
            return null
        }
    }

    public static loadSession<I>(config: MetaDataConfig): {history: I[], outdated: boolean} {
        let outdated = false;
        let metaData: SessionMetaData | null = null;
        let history: I[] = [];
        const meta = this.getMeta(config.sessionDir);
        if (meta) {
            if (meta.llmProtocol !== config.llmProtocol) {
                metaData = this.newSessionMetaData(config);
                // The protocol the history is written in, which is still the old one: it takes an
                // llm call to summarize a history into the shape of another model, and until that
                // call has been made the session holds messages this one refuses. Written here as
                // though it had been made, a migration that never finished would be forgotten --
                // a stop landing in that one call is enough -- and every message after it sent
                // under a shape that is answered with nothing but an error.
                metaData.llmProtocol = meta.llmProtocol;
                metaData.runtime.usage = meta.runtime.usage;
                outdated = true;
            } else {
                metaData = meta;
            }
            history = this.loadHistory<I>(config.sessionDir);
        } else {
            metaData = this.newSessionMetaData(config);
            history = [];
        }
        this.sessionMeta.set(config.sessionDir, metaData);
        return {history, outdated};
    }

    private static loadHistory<I>(sessionDir: string): I[] {
        try {
            const historyFile = `${sessionDir}/${SESSION_HISTORY_FILE}`;
            const content = FileUtils.readFile(historyFile);
            return content.split('\n').filter(line => !!line.trim()).map(line => JSON.parse(line) as I);
        } catch {
            return [];
        }
    }

    private static newSessionMetaData(config: MetaDataConfig): SessionMetaData {
        const now = new Date().toISOString();
        return {
            llmProtocol: config.llmProtocol,
            agentId: config.agentId,
            projectId: config.projectId,
            loopId: config.loopId,
            loopKind: config.loopKind,
            messagesPath: isSpawnedLoop(config.loopKind) ? ''
                : `${config.sessionDir}/${SESSION_HISTORY_FILE}`,
            runtime: {
                status: 'idle',
                turnCount: 0,
                finalText: '',
                startedAt: now,
                updatedAt: now,
                usage: {
                    cachedInputTokens: 0,
                    noCachedInputTokens: 0,
                    outputTokens: 0
                },
            }
        };
    }
    
    public static saveHistory<I>(history: I[], context: OneLoopContext, runtime: Partial<SessionMetaData['runtime']> = {}, force: boolean = false): void {
        // Only a main loop is durably persisted: what a spawned loop said is answered to the loop
        // that spawned it and is gone with the run, it belongs in nobody's session.
        try {
            if (!isSpawnedLoop(context.loopKind) && (force || context.runtime.turnCount > 0)) {
                const historyPath = `${context.sessionDir}/${SESSION_HISTORY_FILE}`;
                try {
                    // Written whole again wherever the history has fewer messages than the file
                    // does, which is what a compaction leaves behind. Appending from an index past
                    // the end of it writes nothing, and the file goes on holding the messages the
                    // run itself has already given up -- the ones that would be read back the next
                    // time the session is loaded, a summary having been written for nothing.
                    if (context.runtime.historyPersistIndex === 0
                        || history.length < context.runtime.historyPersistIndex) {
                        FileUtils.writeFile(historyPath, this.createJsonl(history));
                        context.runtime.historyPersistIndex = history.length;
                    } else {
                        const gap = history.length - context.runtime.historyPersistIndex;
                        if (gap > 0 && (force || history.length < SAVE_THRESHOLD || gap >= SAVE_THRESHOLD)) {
                            FileUtils.appendFile(historyPath,
                                 this.createJsonl(history.slice(context.runtime.historyPersistIndex, history.length)));
                            context.runtime.historyPersistIndex = history.length;
                        }
                    }
                } catch {
                    // TODO ERROR HANDLE
                }
            }
            this.updateSessionRuntime(context, {
                ...runtime, status: runtime.status ?? this.getLoopSessionStatus(context)
            });
        } catch (error) {
            context.logger.error(error, 'Persist loop state failed');
        }
    }

    /**
     * Names the conversation after the first thing that was asked of it, which is what somebody
     * reading a list of them recognises one by. Named once and never again: a name that followed
     * the latest question would rename the conversation out from under whoever was looking for it,
     * and by the end of a long one it would say nothing about how it began.
     */
    public static nameSession(context: OneLoopContext, input: string): void {
        const meta = this.getMeta(context.sessionDir);
        if (!meta || meta.runtime.name) {
            return;
        }
        // Everything after the first line of a question is the paste that came with it, and a whole
        // message would be the conversation over again rather than something to call it by.
        const line = input.split('\n').map(line => line.trim()).find(line => !!line);
        if (!line) {
            return;
        }
        this.updateSessionRuntime(context, {name: this.readName(line)});
    }

    /**
     * The name a line of a question gives: whole sentences of it, enough of them to say something
     * and no more than a line of a list can show. A question is asked in sentences, and one broken
     * off between two of its words reads as a slip rather than as the name of anything.
     *
     * The sentences of a line are only the ones that end, and the last thing asked in a line as
     * often as not ends with nothing at all. Where they do not add up to a name, the whole line is
     * one: `hi. can you look at why the build is slow` has a single sentence in it and being called
     * by it would leave the conversation named `hi.`.
     */
    private static readName(line: string): string {
        let name = '';
        for (const sentence of line.matchAll(SENTENCE)) {
            name += sentence[0];
            if (name.length >= SESSION_NAME_FLOOR) {
                break;
            }
        }
        return this.cutLong(name.length >= SESSION_NAME_FLOOR ? name : line);
    }

    /** Nothing ends the question short enough, so it is cut back between words where there are any. */
    private static cutLong(name: string): string {
        if (name.length <= SESSION_NAME_LIMIT) {
            return name;
        }
        const head = name.slice(0, SESSION_NAME_LIMIT);
        const lastWordEnd = head.lastIndexOf(' ');
        return (lastWordEnd >= SESSION_NAME_FLOOR ? head.slice(0, lastWordEnd) : head).trim();
    }

    /**
     * Says that the history is written in this protocol now, which is only true of it once it has
     * really been summarized into that shape. Whoever loads the session next takes it at its word
     * and compacts nothing, so it is said here rather than where the session is loaded: by then
     * the call it takes has not been made, and a run that ends before making it -- a stop, a
     * failure, the server going down -- would leave the old messages behind under a promise that
     * they had been replaced.
     */
    public static markHistoryProtocol(context: OneLoopContext, llmProtocol: LLMProtocol): void {
        const meta = this.getMeta(context.sessionDir);
        if (!meta || meta.llmProtocol === llmProtocol) {
            return;
        }
        meta.llmProtocol = llmProtocol;
        this.writeMeta(context, meta);
    }

    public static updateSessionRuntime(
        context: OneLoopContext, runtime: Partial<SessionMetaData['runtime']>
    ) {
        const meta = this.getMeta(context.sessionDir);
        if (!meta) {
            logger.warn(`Session metadata not found for session directory: ${context.sessionDir}`);
            return;
        }
        const now = new Date().toISOString();
        const {usage, ...rest} = runtime;
        Object.assign(meta.runtime, {
            ...rest,
            updatedAt: now,
            endedAt: runtime.status === 'idle' || runtime.status === 'error' ? now : undefined
        });
        if (usage) {
            addTokenUsage(meta.runtime.usage, usage);
        }
        this.writeMeta(context, meta);
    }

    /** A spawned loop has no session of its own to stamp: what it did is answered to its parent. */
    private static writeMeta(context: OneLoopContext, meta: SessionMetaData): void {
        if (isSpawnedLoop(context.loopKind)) {
            return;
        }
        FileUtils.writeFile(
            `${context.sessionDir}/${SESSION_METADATA_FILE}`,
            JSON.stringify(meta, null, 2)
        );
    }

    private static createJsonl<I>(history: I[]): string {
        return history.map(line => JSON.stringify(line)).join('\n') + '\n';
    }

    private static getLoopSessionStatus(context: OneLoopContext): LoopSessionStatus {
        const transitionReason = context.runtime.transitionReason;
        const agentBreakReason = context.runtime.agentBreakReason;
        if ((!transitionReason && !agentBreakReason) || transitionReason === 'endLoop' || isExternalInterruptReason(agentBreakReason)) {
            return 'idle';
        }
        if (transitionReason === 'error') {
            return 'error';
        }
        if (isAgentStopReason(agentBreakReason)) {
            return 'paused';
        }
        return 'running';
    }

    public static getTokenUsage(loopId: string): TokenUsage | undefined {
        const meta = this.getMeta(this.getLoopSessionDir(loopId));
        if (!meta) {
            return undefined;
        }
        return meta.runtime.usage;
    }

}
