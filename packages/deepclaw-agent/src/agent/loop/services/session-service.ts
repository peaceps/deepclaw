import { FileUtils } from "@deepclaw/node-utils";
import { SESSION_HISTORY_FILE, SESSION_METADATA_FILE } from "../../paths";
import { LLMProtocol, LoopSessionStatus, OneLoopContext, SessionMetaData } from "../../definitions/definitions";
import { isExternalInterruptReason, isAgentStopReason, isInternalInterruptReason } from "@deepclaw/core";
import { getLogger } from '@deepclaw/node-utils';

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

    public static loadSession<I>(config: MetaDataConfig): I[] {
        let metaData: SessionMetaData | null = null;
        let history: I[] = [];
        const metaFilePath = `${config.sessionDir}/${SESSION_METADATA_FILE}`;
        try {
            const metaFile = FileUtils.readFile(metaFilePath);
            const meta = JSON.parse(metaFile) as SessionMetaData;
            if (meta.llmProtocol !== config.llmProtocol) {
                metaData = this.newSessionMetaData(config);
                metaData.runtime.outdated = true;
            } else {
                metaData = meta;
            }
            history = this.loadHistory<I>(config.sessionDir);
        } catch {
            metaData = this.newSessionMetaData(config);
            history = [];
            logger.error(`Failed to load session metadata from ${metaFilePath}`);
        }
        this.sessionMeta.set(config.sessionDir, metaData);
        return history;
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
            messagesPath: `${config.sessionDir}/${SESSION_HISTORY_FILE}`,
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
                outdated: false
            }
        };
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
            this.updateSessionRuntime(context.sessionDir, {
                ...runtime, status: runtime.status ?? this.getLoopSessionStatus(context)
            })
        } catch (error) {
            context.logger.error(error, 'Persist loop state failed');
        }
    }

    public static updateSessionRuntime(
        sessionDir: string, runtime: Partial<SessionMetaData['runtime']>
    ) {
        const meta = this.sessionMeta.get(sessionDir);
        if (!meta) {
            throw new Error(`Session metadata not found for session directory: ${sessionDir}`);
        }
        const now = new Date().toISOString();
        const {usage, ...rest} = runtime;
        Object.assign(meta.runtime, {
            ...rest,
            updatedAt: now,
            endedAt: runtime.status === 'idle' || runtime.status === 'error' ? now : undefined
        });
        if (usage) {
            meta.runtime.usage.cachedInputTokens += usage.cachedInputTokens;
            meta.runtime.usage.noCachedInputTokens += usage.noCachedInputTokens;
            meta.runtime.usage.outputTokens += usage.outputTokens;
            usage.cachedInputTokens = 0;
            usage.noCachedInputTokens = 0;
            usage.outputTokens = 0;
        }
        FileUtils.writeFile(`${sessionDir}/${SESSION_METADATA_FILE}`, JSON.stringify(meta, null, 2));
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

    public static isOutdated(sessionDir: string): boolean {
        const meta = this.sessionMeta.get(sessionDir);
        if (!meta) {
            return false;
        }
        return meta.runtime.outdated;
    }

    public static markNotOutdated(sessionDir: string): void {
        const meta = this.sessionMeta.get(sessionDir);
        if (!meta) {
            return;
        }
        meta.runtime.outdated = false;
    }

}
