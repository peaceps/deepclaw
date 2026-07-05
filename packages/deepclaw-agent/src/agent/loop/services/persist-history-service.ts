import { FileUtils } from "@deepclaw/node-utils";
import { AGENT_SESSION_DIR, AGENTS_DIR, MESSAGE_SNAPSHOT_FILE, SESSION_METADATA_FILE } from "../../paths";
import { isToolStopReason, LLMProtocol, LoopSessionStatus, OneLoopContext, SessionMetadata } from "../../definitions/definitions";

const SESSION_TIMEOUT = 1000 * 60 * 60 * 24;
const SAVE_THRESHOLD = 10;

export type MetaDataConfig = {
    llmProtocol: LLMProtocol;
    sessionId: string;
    parentSessionId: string;
    status?: LoopSessionStatus;
    finalText?: string;
    forceMessagesSnapshot?: boolean;
}

export class PersistHistoryService {

    public static loadLatestAgentSessionId(agentId: string, protocol: LLMProtocol): string {
        const sessionRoot = `${AGENTS_DIR}/${agentId}/${AGENT_SESSION_DIR}`;
        const sessionId = FileUtils.findLatest(sessionRoot, MESSAGE_SNAPSHOT_FILE);
        if (!sessionId) {
            return '';
        }
        try {
            const metaFile = FileUtils.readFile(`${sessionRoot}/${sessionId}/${SESSION_METADATA_FILE}`);
            const meta = JSON.parse(metaFile) as SessionMetadata;
            if (meta.llmProtocol !== protocol) {
                return '';
            }
            const status = meta.status;
            const date = new Date(meta.updatedAt);
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
                case 'ended':
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
            const content = FileUtils.readFile(`${sessionDir}/${MESSAGE_SNAPSHOT_FILE}`);
            const messages = content.split('\n').filter(line => !!line.trim()).map(line => JSON.parse(line) as I);
            return messages;
        } catch {
            return [];
        }
    }
    
    public static saveHistory<I>(history: I[], context: OneLoopContext, config: MetaDataConfig): void {
        // Sub-loop context is intentionally not durably persisted; only parent/main loop state is durable.
        if (context.isSubLoop) {
            return;
        }
        try {
            const now = new Date().toISOString();
            const messagesPath = `${context.sessionDir}/${MESSAGE_SNAPSHOT_FILE}`;
            if (config.forceMessagesSnapshot || context.turnCount > 0) {
                try {
                    if (context.historyPersistIndex === 0) {
                        FileUtils.writeFile(messagesPath, this.createJsonl(history));
                        context.historyPersistIndex = history.length;
                    } else {
                        const gap = history.length - context.historyPersistIndex;
                        if (config.forceMessagesSnapshot || history.length < SAVE_THRESHOLD || gap >= SAVE_THRESHOLD) {
                            FileUtils.appendFile(messagesPath,
                                 this.createJsonl(history.slice(context.historyPersistIndex, history.length)));
                            context.historyPersistIndex = history.length;
                        }
                    }
                } catch {
                    // TODO ERROR HANDLE
                }
            }
            const status = config.status || this.getInvokeEndSessionStatus(context);
            const metadata: SessionMetadata = {
                llmProtocol: config.llmProtocol,
                agentId: context.agentId,
                projectId: context.projectId,
                sessionId: config.sessionId,
                parentSessionId: config.parentSessionId || undefined,
                loopId: context.loopId,
                isSubLoop: context.isSubLoop,
                status,
                transitionReason: context.transitionReason,
                turnCount: context.turnCount,
                messagesPath,
                finalText: config.finalText,
                updatedAt: now,
                endedAt: status === 'running' ? undefined : now,
            };
            FileUtils.writeFile(
                `${context.sessionDir}/${SESSION_METADATA_FILE}`, JSON.stringify(metadata, null, 2)
            );
        } catch (error) {
            context.logger.error(error, 'Persist loop state failed');
        }
    }

    private static createJsonl<I>(history: I[]): string {
        return history.map(line => JSON.stringify(line)).join('\n') + '\n';
    }

    private static getLoopSessionStatus(context: OneLoopContext): LoopSessionStatus {
        if (context.transitionReason === 'error') {
            return 'error';
        }
        if (isToolStopReason(context.transitionReason)) {
            return 'paused';
        }
        if (context.transitionReason === 'endLoop') {
            return 'ended';
        }
        return 'running';
    }

    private static getInvokeEndSessionStatus(context: OneLoopContext): LoopSessionStatus {
        if (!context.transitionReason) {
            return 'ended';
        }
        return this.getLoopSessionStatus(context);
    }

}
