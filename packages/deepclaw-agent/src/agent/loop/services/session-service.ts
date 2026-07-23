import { FileUtils } from "@deepclaw/node-utils";
import {
    AGENTS_DIR, CRON_DIR, PROJECT_DIR, SESSION_DIR, SESSION_HISTORY_FILE, SESSION_METADATA_FILE,
    SUB_LOOP_DIR
} from "../../paths";
import { LLMProtocol, LoopSessionStatus, OneLoopContext, SessionMetaData } from "../../definitions/definitions";
import { isExternalInterruptReason, isAgentStopReason, isInternalInterruptReason, TokenUsage, splitLoopId, FlushAgentRole, addTokenUsage } from "@deepclaw/core";
import { getLogger } from "@deepclaw/node-utils";

const SAVE_THRESHOLD = 10;
const logger = getLogger('SessionService');

export type MetaDataConfig = {
    sessionDir: string,
    agentId: string,
    projectId: string,
    loopId: string,
    isSubLoop: boolean,
    llmProtocol: LLMProtocol;
}

export class SessionService {

    private static sessionMeta: Map<string, SessionMetaData> = new Map();

    public static getSessionDir(role: FlushAgentRole, agentId: string, projectId?: string, subLoopId?: string): string {
        if (subLoopId) {
            return `${FileUtils.getTmpDir()}/${SUB_LOOP_DIR}/${subLoopId}`;
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
        return {
            llmProtocol: config.llmProtocol,
            agentId: config.agentId,
            projectId: config.projectId,
            loopId: config.loopId,
            isSubLoop: config.isSubLoop,
            messagesPath: config.isSubLoop ? '' : `${config.sessionDir}/${SESSION_HISTORY_FILE}`,
            runtime: {
                status: 'idle',
                turnCount: 0,
                finalText: '',
                updatedAt: new Date().toISOString(),
                usage: {
                    cachedInputTokens: 0,
                    noCachedInputTokens: 0,
                    outputTokens: 0
                },
            }
        };
    }
    
    public static saveHistory<I>(history: I[], context: OneLoopContext, runtime: Partial<SessionMetaData['runtime']> = {}, force: boolean = false): void {
        // Sub-loop context is intentionally not durably persisted; only parent/main loop state is durable.
        try {
            if (!context.isSubLoop && (force || context.runtime.turnCount > 0)) {
                const historyPath = `${context.sessionDir}/${SESSION_HISTORY_FILE}`;
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
            this.updateSessionRuntime(context, {
                ...runtime, status: runtime.status ?? this.getLoopSessionStatus(context)
            });
        } catch (error) {
            context.logger.error(error, 'Persist loop state failed');
        }
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
        if (!context.isSubLoop) {
            FileUtils.writeFile(
                `${context.sessionDir}/${SESSION_METADATA_FILE}`,
                JSON.stringify(meta, null, 2)
            );
        }
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
        if (isAgentStopReason(agentBreakReason) || isInternalInterruptReason(agentBreakReason)) {
            return 'paused';
        }
        return 'running';
    }

    public static getTokenUsage(loopId: string): TokenUsage | undefined {
        const {role, agentId, projectId} = splitLoopId(loopId);
        const sessionDir = this.getSessionDir(role, agentId, projectId ?? '');
        const meta = this.getMeta(sessionDir);
        if (!meta) {
            return undefined;
        }
        return meta.runtime.usage;
    }

}
