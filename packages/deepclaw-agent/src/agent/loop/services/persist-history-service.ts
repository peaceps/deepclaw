import { FileUtils } from "@deepclaw/node-utils";
import { AGENT_SESSION_DIR, AGENTS_DIR, SESSION_HISTORY_FILE, SESSION_METADATA_FILE } from "../../paths";
import { LLMProtocol, LoopSessionStatus, OneLoopContext, SessionMetaData } from "../../definitions/definitions";
import { isExternalStopReason, isToolStopReason, isToolInteractionPauseReason } from "@deepclaw/core";

const SESSION_TIMEOUT = 1000 * 60 * 60 * 24;
const SAVE_THRESHOLD = 10;

export type MetaDataConfig = {
    sessionDir: string,
    sessionId: string;
    agentId: string,
    projectId: string,
    loopId: string,
    isSubLoop: boolean,
    llmProtocol: LLMProtocol;
    parentSessionId: string;
}

export class PersistHistoryService {

    public static loadLatestAgentSessionId(agentId: string, protocol: LLMProtocol): string {
        const sessionRoot = `${AGENTS_DIR}/${agentId}/${AGENT_SESSION_DIR}`;
        const sessionId = FileUtils.findLatest(sessionRoot, SESSION_HISTORY_FILE);
        if (!sessionId) {
            return '';
        }
        try {
            const metaFile = FileUtils.readFile(`${sessionRoot}/${sessionId}/${SESSION_METADATA_FILE}`);
            const meta = JSON.parse(metaFile) as SessionMetaData;
            if (meta.llmProtocol !== protocol) {
                return '';
            }
            const status = meta.runtime.status;
            const date = new Date(meta.runtime.updatedAt);
            if (Number.isNaN(date.getTime())) {
                return '';
            }
            let timeout = SESSION_TIMEOUT;
            switch(status) {
                case 'running':
                    timeout = SESSION_TIMEOUT * 2;
                    break;
                case 'paused':
                    timeout = SESSION_TIMEOUT * 7;
                    break;
                case 'idle':
                case 'error':
                default:
                    timeout = 0;
                    break;
            }
            const diff = new Date().getTime() - date.getTime();
            if (diff > timeout) {
                return '';
            }
            return sessionId;
        } catch {}
        return '';
    }

    public static loadHistory<I>(sessionDir: string): I[] {
        try {
            const historyFile = `${sessionDir}/${SESSION_HISTORY_FILE}`;
            const content = FileUtils.readFile(historyFile);
            return content.split('\n').filter(line => !!line.trim()).map(line => JSON.parse(line) as I);
        } catch {
            return [];
        }
    }

    public static ensureSessionFilesExist(config: MetaDataConfig): void {
        const sessionDir = config.sessionDir;
        const historyFile = `${sessionDir}/${SESSION_HISTORY_FILE}`;
        const metaFile = `${sessionDir}/${SESSION_METADATA_FILE}`;
        FileUtils.ensureFileExist(historyFile);
        const now = new Date().toISOString();
        const metaData: SessionMetaData = {
            llmProtocol: config.llmProtocol,
            agentId: config.agentId,
            projectId: config.projectId,
            sessionId: config.sessionId,
            parentSessionId: config.parentSessionId || undefined,
            loopId: config.loopId,
            isSubLoop: config.isSubLoop,
            messagesPath: historyFile,
            runtime: {
                status: 'idle',
                turnCount: 0,
                finalText: '',
                updatedAt: now,
            }
        }
        FileUtils.ensureFileExist(metaFile, JSON.stringify(metaData, null, 2));
    }
    
    public static saveHistory<I>(history: I[], context: OneLoopContext, runtime: Partial<SessionMetaData['runtime']> = {}, force: boolean = false): void {
        // Sub-loop context is intentionally not durably persisted; only parent/main loop state is durable.
        if (context.isSubLoop) {
            return;
        }
        try {
            const historyPath = `${context.sessionDir}/${SESSION_HISTORY_FILE}`;
            if (force || context.runtime.turnCount > 0) {
                try {
                    if (context.runtime.historyPersistIndex === 0) {
                        FileUtils.writeFile(historyPath, this.createJsonl(history));
                        context.runtime.historyPersistIndex = history.length;
                    } else {
                        const gap = history.length - context.runtime.historyPersistIndex;
                        if (force || history.length < SAVE_THRESHOLD || gap >= SAVE_THRESHOLD) {
                            FileUtils.appendFile(historyPath,
                                 this.createJsonl(history.slice(context.runtime.historyPersistIndex, history.length)));
                            context.runtime.historyPersistIndex = history.length;
                        }
                    }
                } catch {
                    // TODO ERROR HANDLE
                }
            }
            this.updateSessionRuntime(context.sessionDir, {...runtime, status: runtime.status ?? this.getLoopSessionStatus(context)})
        } catch (error) {
            context.logger.error(error, 'Persist loop state failed');
        }
    }

    public static updateSessionRuntime(sessionDir: string, runtime: Partial<SessionMetaData['runtime']>) {
        const path = `${sessionDir}/${SESSION_METADATA_FILE}`;
        const metaFile = FileUtils.readFile(path);
        const meta = JSON.parse(metaFile) as SessionMetaData;
        const now = new Date().toISOString();
        Object.assign(meta.runtime, {
            ...runtime,
            updatedAt: now,
            endedAt: runtime.status === 'idle' || runtime.status === 'error' ? now : undefined
        });
        FileUtils.writeFile(path, JSON.stringify(meta, null, 2));
    }

    private static createJsonl<I>(history: I[]): string {
        return history.map(line => JSON.stringify(line)).join('\n') + '\n';
    }

    private static getLoopSessionStatus(context: OneLoopContext): LoopSessionStatus {
        const transitionReason = context.runtime.transitionReason;
        const interruptReason = context.runtime.interruptReason;
        if ((!transitionReason && !interruptReason) || transitionReason === 'endLoop' || isExternalStopReason(interruptReason)) {
            return 'idle';
        }
        if (transitionReason === 'error') {
            return 'error';
        }
        if (isToolStopReason(interruptReason) || isToolInteractionPauseReason(interruptReason)) {
            return 'paused';
        }
        return 'running';
    }

}
