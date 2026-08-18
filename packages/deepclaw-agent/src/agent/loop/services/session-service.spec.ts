import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type OneLoopContext, type SessionMetaData} from '../../definitions/definitions';
import {newTestContext} from '../../../test-support/one-loop-context';
import {SessionService} from './session-service';

const mocks = vi.hoisted(() => ({
    readFile: vi.fn<(filePath: string) => string>(),
    writeFile: vi.fn<(filePath: string, content: string) => string>(),
    appendFile: vi.fn<(filePath: string, content: string) => void>(),
    getTmpDir: vi.fn<() => string>(),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {
        readFile: mocks.readFile,
        writeFile: mocks.writeFile,
        appendFile: mocks.appendFile,
        getTmpDir: mocks.getTmpDir,
    },
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    getLoopLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

const disk: {[filePath: string]: string} = {};
let sessionCounter = 0;

/** The metadata cache is keyed by session directory, so every test works in a directory of its own. */
function nextSessionDir(): string {
    return `.agents/s${sessionCounter++}/session`;
}

function historyPath(context: OneLoopContext): string {
    return `${context.sessionDir}/messages.jsonl`;
}

function metaPath(sessionDir: string): string {
    return `${sessionDir}/session.json`;
}

function history(length: number): {i: number}[] {
    return Array.from(Array(length).keys()).map(i => ({i}));
}

function persistedMeta(sessionDir: string): SessionMetaData {
    const written = mocks.writeFile.mock.calls.filter(call => call[0] === metaPath(sessionDir)).at(-1);
    return JSON.parse(written![1]) as SessionMetaData;
}

function startSession(overrides: Partial<OneLoopContext> = {}): OneLoopContext {
    const context = newTestContext({sessionDir: nextSessionDir(), ...overrides});
    SessionService.loadSession({
        sessionDir: context.sessionDir,
        agentId: context.agentId,
        projectId: context.projectId,
        loopId: context.loopId,
        loopKind: context.loopKind,
        llmProtocol: 'Anthropic',
    });
    return context;
}

beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(disk)) {
        delete disk[key];
    }
    mocks.readFile.mockImplementation((filePath: string) => {
        const content = disk[filePath];
        if (content === undefined) {
            throw new Error(`File ${filePath} not found.`);
        }
        return content;
    });
    mocks.writeFile.mockImplementation((filePath: string) => filePath);
    mocks.getTmpDir.mockReturnValue('/tmp/.deepclaw');
});

describe('getSessionDir', () => {

    test('puts a sub loop into the temporary folder whatever its role is', () => {
        expect(SessionService.getSessionDir('agent', 'a1', 'p1', {kind: 'sub', runId: 'sub9'}))
            .toBe('/tmp/.deepclaw/subloop/sub9');
    });

    /** One folder per run, and never the folder of the session the run was spawned out of. */
    test('gives a task loop a run folder of its own', () => {
        expect(SessionService.getSessionDir('project', 'a1', 'p1', {kind: 'task', runId: 'task7'}))
            .toBe('/tmp/.deepclaw/taskloop/task7');
    });

    test('puts an agent loop next to the agent files', () => {
        expect(SessionService.getSessionDir('agent', 'a1')).toBe('.agents/a1/session');
    });

    test('puts a cron loop into the temporary cron folder', () => {
        expect(SessionService.getSessionDir('cron', 'a1', 'p1')).toBe('/tmp/.deepclaw/.cron/p1/session');
    });

    test('puts a project loop into the project folder', () => {
        expect(SessionService.getSessionDir('project', 'a1', 'p1')).toBe('.projects/p1/session');
    });

    test('rejects a role it does not know', () => {
        expect(() => SessionService.getSessionDir('boss' as 'agent', 'a1'))
            .toThrow('Unknown flush agent role: boss');
    });
});

describe('loadSession', () => {

    function newMeta(overrides: Partial<SessionMetaData> = {}): SessionMetaData {
        return {
            llmProtocol: 'Anthropic',
            agentId: 'a1',
            projectId: '',
            loopId: 'agent.a1',
            loopKind: 'main' as const,
            messagesPath: 'stored/messages.jsonl',
            runtime: {
                status: 'idle',
                turnCount: 7,
                finalText: 'the previous answer',
                updatedAt: '2024-01-01T00:00:00.000Z',
                usage: {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3},
            },
            ...overrides,
        };
    }

    test('starts an empty session when no metadata is on disk', () => {
        const sessionDir = nextSessionDir();
        expect(SessionService.loadSession({
            sessionDir, agentId: 'a1', projectId: '', loopId: 'agent.a1',
            loopKind: 'main' as const, llmProtocol: 'Anthropic',
        })).toEqual({history: [], outdated: false});
    });

    test('does not even look at the history file without metadata', () => {
        const sessionDir = nextSessionDir();
        SessionService.loadSession({
            sessionDir, agentId: 'a1', projectId: '', loopId: 'agent.a1',
            loopKind: 'main' as const, llmProtocol: 'Anthropic',
        });
        expect(mocks.readFile).not.toHaveBeenCalledWith(`${sessionDir}/messages.jsonl`);
    });

    test('reads the stored history when the protocol still matches', () => {
        const sessionDir = nextSessionDir();
        disk[metaPath(sessionDir)] = JSON.stringify(newMeta());
        disk[`${sessionDir}/messages.jsonl`] = '{"role":"user"}\n{"role":"assistant"}\n';
        expect(SessionService.loadSession({
            sessionDir, agentId: 'a1', projectId: '', loopId: 'agent.a1',
            loopKind: 'main' as const, llmProtocol: 'Anthropic',
        })).toEqual({history: [{role: 'user'}, {role: 'assistant'}], outdated: false});
    });

    test('ignores blank lines in the history file', () => {
        const sessionDir = nextSessionDir();
        disk[metaPath(sessionDir)] = JSON.stringify(newMeta());
        disk[`${sessionDir}/messages.jsonl`] = '{"role":"user"}\n\n  \n{"role":"assistant"}\n';
        const {history} = SessionService.loadSession({
            sessionDir, agentId: 'a1', projectId: '', loopId: 'agent.a1',
            loopKind: 'main' as const, llmProtocol: 'Anthropic',
        });
        expect(history).toHaveLength(2);
    });

    test('gives up on the whole history when one line is broken', () => {
        const sessionDir = nextSessionDir();
        disk[metaPath(sessionDir)] = JSON.stringify(newMeta());
        disk[`${sessionDir}/messages.jsonl`] = '{"role":"user"}\nnot json\n';
        const {history} = SessionService.loadSession({
            sessionDir, agentId: 'a1', projectId: '', loopId: 'agent.a1',
            loopKind: 'main' as const, llmProtocol: 'Anthropic',
        });
        expect(history).toEqual([]);
    });

    test('starts with an empty history when the history file is missing', () => {
        const sessionDir = nextSessionDir();
        disk[metaPath(sessionDir)] = JSON.stringify(newMeta());
        const {history, outdated} = SessionService.loadSession({
            sessionDir, agentId: 'a1', projectId: '', loopId: 'agent.a1',
            loopKind: 'main' as const, llmProtocol: 'Anthropic',
        });
        expect(history).toEqual([]);
        expect(outdated).toBe(false);
    });

    test('marks the session outdated but keeps the token usage when the protocol changed', () => {
        const sessionDir = nextSessionDir();
        disk[metaPath(sessionDir)] = JSON.stringify(newMeta({llmProtocol: 'OpenAIChat'}));
        const context = newTestContext({sessionDir});
        const {outdated} = SessionService.loadSession({
            sessionDir, agentId: 'a1', projectId: '', loopId: 'agent.a1',
            loopKind: 'main' as const, llmProtocol: 'Anthropic',
        });
        SessionService.updateSessionRuntime(context, {});
        const meta = persistedMeta(sessionDir);
        expect(outdated).toBe(true);
        expect(meta.llmProtocol).toBe('Anthropic');
        expect(meta.runtime.usage).toEqual({cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3});
        expect(meta.runtime.turnCount).toBe(0);
        expect(meta.runtime.finalText).toBe('');
    });

    test('hands out the old history when the protocol changed so the loop can summarize it', () => {
        const sessionDir = nextSessionDir();
        disk[metaPath(sessionDir)] = JSON.stringify(newMeta({llmProtocol: 'OpenAIChat'}));
        disk[`${sessionDir}/messages.jsonl`] = '{"role":"user"}\n';
        const {history} = SessionService.loadSession({
            sessionDir, agentId: 'a1', projectId: '', loopId: 'agent.a1',
            loopKind: 'main' as const, llmProtocol: 'Anthropic',
        });
        expect(history).toEqual([{role: 'user'}]);
    });

    test('records where the messages of a main loop are stored', () => {
        const context = startSession();
        SessionService.updateSessionRuntime(context, {});
        expect(persistedMeta(context.sessionDir).messagesPath)
            .toBe(`${context.sessionDir}/messages.jsonl`);
    });

    test('leaves the messages path empty for a sub loop', () => {
        const sessionDir = nextSessionDir();
        SessionService.loadSession({
            sessionDir, agentId: 'a1', projectId: '', loopId: 'agent.a1',
            loopKind: 'sub', llmProtocol: 'Anthropic',
        });
        SessionService.updateSessionRuntime(newTestContext({sessionDir}), {});
        expect(persistedMeta(sessionDir).messagesPath).toBe('');
    });

    test('reads the metadata file only once per session directory', () => {
        const sessionDir = nextSessionDir();
        disk[metaPath(sessionDir)] = JSON.stringify(newMeta());
        const config = {
            sessionDir, agentId: 'a1', projectId: '', loopId: 'agent.a1',
            loopKind: 'main' as const, llmProtocol: 'Anthropic' as const,
        };
        SessionService.loadSession(config);
        SessionService.loadSession(config);
        expect(mocks.readFile.mock.calls.filter(call => call[0] === metaPath(sessionDir))).toHaveLength(1);
    });
});

describe('saveHistory persistence', () => {

    test('persists nothing for a sub loop', () => {
        const context = startSession({loopKind: 'sub'});
        context.runtime.turnCount = 3;
        SessionService.saveHistory([{i: 1}], context);
        expect(mocks.writeFile).not.toHaveBeenCalled();
        expect(mocks.appendFile).not.toHaveBeenCalled();
    });

    /** A task loop is a run of its own, and a run is over before anybody could resume it. */
    test('persists nothing for a task loop', () => {
        const context = startSession({loopKind: 'task'});
        context.runtime.turnCount = 3;
        SessionService.saveHistory([{i: 1}], context, {}, true);
        expect(mocks.writeFile).not.toHaveBeenCalled();
        expect(mocks.appendFile).not.toHaveBeenCalled();
    });

    test('keeps the history in memory before the first turn', () => {
        const context = startSession();
        SessionService.saveHistory([{i: 1}], context);
        expect(mocks.writeFile).not.toHaveBeenCalledWith(historyPath(context), expect.anything());
        expect(mocks.appendFile).not.toHaveBeenCalled();
    });

    test('persists before the first turn when forced', () => {
        const context = startSession();
        SessionService.saveHistory([{i: 1}], context, {}, true);
        expect(mocks.writeFile).toHaveBeenCalledWith(historyPath(context), '{"i":1}\n');
    });

    test('writes the whole history the first time and remembers how much was stored', () => {
        const context = startSession();
        context.runtime.turnCount = 1;
        SessionService.saveHistory([{i: 1}, {i: 2}], context);
        expect(mocks.writeFile).toHaveBeenCalledWith(historyPath(context), '{"i":1}\n{"i":2}\n');
        expect(context.runtime.historyPersistIndex).toBe(2);
    });

    test('appends only the new messages while the history is short', () => {
        const context = startSession();
        context.runtime.turnCount = 1;
        context.runtime.historyPersistIndex = 1;
        SessionService.saveHistory([{i: 1}, {i: 2}, {i: 3}], context);
        expect(mocks.appendFile).toHaveBeenCalledExactlyOnceWith(historyPath(context), '{"i":2}\n{"i":3}\n');
        expect(context.runtime.historyPersistIndex).toBe(3);
    });

    test('buffers the new messages once the history reached the threshold size', () => {
        const context = startSession();
        context.runtime.turnCount = 1;
        context.runtime.historyPersistIndex = 5;
        SessionService.saveHistory(history(10), context);
        expect(mocks.appendFile).not.toHaveBeenCalled();
        expect(context.runtime.historyPersistIndex).toBe(5);
    });

    test('appends the last messages of a history that stays under the threshold', () => {
        const context = startSession();
        context.runtime.turnCount = 1;
        context.runtime.historyPersistIndex = 5;
        SessionService.saveHistory(history(9), context);
        expect(mocks.appendFile).toHaveBeenCalledOnce();
        expect(context.runtime.historyPersistIndex).toBe(9);
    });

    test('flushes the buffer as soon as the gap reaches the threshold', () => {
        const context = startSession();
        context.runtime.turnCount = 1;
        context.runtime.historyPersistIndex = 10;
        SessionService.saveHistory(history(20), context);
        expect(mocks.appendFile).toHaveBeenCalledOnce();
        expect(context.runtime.historyPersistIndex).toBe(20);
    });

    test('keeps buffering while the gap is one short of the threshold', () => {
        const context = startSession();
        context.runtime.turnCount = 1;
        context.runtime.historyPersistIndex = 10;
        SessionService.saveHistory(history(19), context);
        expect(mocks.appendFile).not.toHaveBeenCalled();
    });

    test('flushes whatever is buffered when forced', () => {
        const context = startSession();
        context.runtime.turnCount = 1;
        context.runtime.historyPersistIndex = 10;
        SessionService.saveHistory(history(11), context, {}, true);
        expect(mocks.appendFile).toHaveBeenCalledOnce();
        expect(context.runtime.historyPersistIndex).toBe(11);
    });

    test('still updates the session runtime when the history cannot be written', () => {
        const context = startSession();
        context.runtime.turnCount = 1;
        mocks.writeFile.mockImplementation((filePath: string) => {
            if (filePath === historyPath(context)) {
                throw new Error('disk full');
            }
            return filePath;
        });
        SessionService.saveHistory([{i: 1}], context);
        expect(context.logger.error).not.toHaveBeenCalled();
        expect(persistedMeta(context.sessionDir).runtime.status).toBe('idle');
    });

    test('reports a failure to persist the loop state', () => {
        const context = startSession();
        context.runtime.turnCount = 1;
        mocks.writeFile.mockImplementation(() => {
            throw new Error('disk full');
        });
        SessionService.saveHistory([{i: 1}], context);
        expect(context.logger.error).toHaveBeenCalledWith(expect.any(Error), 'Persist loop state failed');
    });
});

describe('saveHistory status', () => {

    function statusOf(runtime: Partial<OneLoopContext['runtime']>): string {
        const context = startSession();
        Object.assign(context.runtime, runtime);
        SessionService.saveHistory([], context);
        return persistedMeta(context.sessionDir).runtime.status;
    }

    test('is idle when nothing interrupted the loop', () => {
        expect(statusOf({})).toBe('idle');
    });

    test('is idle when the loop ended on its own', () => {
        expect(statusOf({transitionReason: 'endLoop'})).toBe('idle');
    });

    test('is idle when the client went away', () => {
        expect(statusOf({transitionReason: 'toolUse', agentBreakReason: 'clientLost'})).toBe('idle');
    });

    test('is error when the loop stopped on an error', () => {
        expect(statusOf({transitionReason: 'error'})).toBe('error');
    });

    test('is paused when the agent stopped itself', () => {
        expect(statusOf({transitionReason: 'toolUse', agentBreakReason: 'taskPause'})).toBe('paused');
    });

    test('is paused when the user did not answer', () => {
        expect(statusOf({transitionReason: 'toolUse', agentBreakReason: 'interactionAfk'})).toBe('paused');
    });

    test('is running while the loop is still calling tools', () => {
        expect(statusOf({transitionReason: 'toolUse'})).toBe('running');
    });

    test('keeps the status the caller asked for', () => {
        const context = startSession();
        context.runtime.transitionReason = 'error';
        SessionService.saveHistory([], context, {status: 'running'});
        expect(persistedMeta(context.sessionDir).runtime.status).toBe('running');
    });

    test('stamps the end time when the loop goes idle', () => {
        const context = startSession();
        SessionService.saveHistory([], context);
        const {updatedAt, endedAt} = persistedMeta(context.sessionDir).runtime;
        expect(endedAt).toBe(updatedAt);
    });

    test('leaves the end time out while the loop is running', () => {
        const context = startSession();
        context.runtime.transitionReason = 'toolUse';
        SessionService.saveHistory([], context);
        expect(persistedMeta(context.sessionDir).runtime.endedAt).toBeUndefined();
    });

    test('stores the extra runtime fields the caller passed', () => {
        const context = startSession();
        SessionService.saveHistory([], context, {turnCount: 4, finalText: 'all done'});
        const meta = persistedMeta(context.sessionDir);
        expect(meta.runtime.turnCount).toBe(4);
        expect(meta.runtime.finalText).toBe('all done');
    });
});

describe('updateSessionRuntime', () => {

    test('does nothing for a session it never loaded', () => {
        const context = newTestContext({sessionDir: nextSessionDir()});
        SessionService.updateSessionRuntime(context, {status: 'running'});
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    test('adds the reported token usage to the total', () => {
        const context = startSession();
        const usage = {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3};
        SessionService.updateSessionRuntime(context, {usage});
        SessionService.updateSessionRuntime(context, {usage});
        expect(persistedMeta(context.sessionDir).runtime.usage)
            .toEqual({cachedInputTokens: 2, noCachedInputTokens: 4, outputTokens: 6});
    });

    test('keeps the totals when no usage is reported', () => {
        const context = startSession();
        SessionService.updateSessionRuntime(context, {
            usage: {cachedInputTokens: 5, noCachedInputTokens: 0, outputTokens: 0},
        });
        SessionService.updateSessionRuntime(context, {status: 'running'});
        expect(persistedMeta(context.sessionDir).runtime.usage.cachedInputTokens).toBe(5);
    });

    test('does not write the metadata file of a sub loop', () => {
        const context = startSession({loopKind: 'sub'});
        SessionService.updateSessionRuntime(context, {status: 'running'});
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    /** The status of a session belongs to the loop a user talks to, not to the runs it hands out. */
    test('does not write the metadata file of a task loop either', () => {
        const context = startSession({loopKind: 'task'});
        SessionService.updateSessionRuntime(context, {status: 'running'});
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    test('writes the metadata as readable json', () => {
        const context = startSession();
        SessionService.updateSessionRuntime(context, {status: 'running'});
        const [, content] = mocks.writeFile.mock.calls.at(-1)!;
        expect(content).toContain('\n  "llmProtocol": "Anthropic"');
    });
});

describe('getTokenUsage', () => {

    test('answers with nothing for a loop that has no session', () => {
        expect(SessionService.getTokenUsage('agent.ghost')).toBeUndefined();
    });

    test('answers with the total usage of an agent loop', () => {
        const context = newTestContext({sessionDir: '.agents/usageAgent/session'});
        SessionService.loadSession({
            sessionDir: context.sessionDir, agentId: 'usageAgent', projectId: '',
            loopId: 'agent.usageAgent', loopKind: 'main' as const, llmProtocol: 'Anthropic',
        });
        SessionService.updateSessionRuntime(context, {
            usage: {cachedInputTokens: 10, noCachedInputTokens: 20, outputTokens: 30},
        });
        expect(SessionService.getTokenUsage('agent.usageAgent'))
            .toEqual({cachedInputTokens: 10, noCachedInputTokens: 20, outputTokens: 30});
    });

    test('resolves a project loop id to the session of the project', () => {
        const sessionDir = '.projects/usageProject/session';
        SessionService.loadSession({
            sessionDir, agentId: 'a1', projectId: 'usageProject',
            loopId: 'project.a1.usageProject', loopKind: 'main' as const, llmProtocol: 'Anthropic',
        });
        expect(SessionService.getTokenUsage('project.a1.usageProject'))
            .toEqual({cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0});
    });

    test('resolves a cron loop id to the temporary cron session', () => {
        const sessionDir = '/tmp/.deepclaw/.cron/usageCron/session';
        SessionService.loadSession({
            sessionDir, agentId: 'a1', projectId: 'usageCron',
            loopId: 'cron.a1.usageCron', loopKind: 'main' as const, llmProtocol: 'Anthropic',
        });
        expect(SessionService.getTokenUsage('cron.a1.usageCron')).toBeDefined();
    });
});
