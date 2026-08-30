import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type OneLoopContext, type SessionMetaData} from '../../definitions/definitions';
import {newTestContext} from '../../../test-support/one-loop-context';
import {SessionService} from './session-service';

const mocks = vi.hoisted(() => ({
    readFile: vi.fn<(filePath: string) => string>(),
    writeFile: vi.fn<(filePath: string, content: string) => string>(),
    appendFile: vi.fn<(filePath: string, content: string) => void>(),
    getTmpDir: vi.fn<() => string>(),
    exists: vi.fn<(filePath: string) => boolean>(),
    movePath: vi.fn<(from: string, to: string) => boolean>(),
    timestamp: vi.fn<() => string>(),
    readDir: vi.fn<(dirPath: string, fileToRead?: (name: string) => string) =>
        {[key: string]: {dir: string, content: string}}>(),
    listDirs: vi.fn<(dirPath: string) => string[]>(),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {
        readFile: mocks.readFile,
        writeFile: mocks.writeFile,
        appendFile: mocks.appendFile,
        getTmpDir: mocks.getTmpDir,
        exists: mocks.exists,
        movePath: mocks.movePath,
        timestamp: mocks.timestamp,
        readDir: mocks.readDir,
        listDirs: mocks.listDirs,
    },
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    getLoopLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

const disk: {[filePath: string]: string} = {};
let sessionCounter = 0;
let timestampCounter = 0;

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
    // A folder is whatever has something under it, which is as much of one as the disk has.
    mocks.exists.mockImplementation((filePath: string) =>
        Object.keys(disk).some(path => path === filePath || path.startsWith(`${filePath}/`)));
    mocks.movePath.mockImplementation((from: string, to: string) => {
        const moved = Object.keys(disk).filter(path => path === from || path.startsWith(`${from}/`));
        for (const path of moved) {
            disk[`${to}${path.slice(from.length)}`] = disk[path]!;
            delete disk[path];
        }
        return moved.length > 0;
    });
    // A session id is a timestamp to the millisecond, and only a name shaped like one is a session.
    mocks.timestamp.mockImplementation(
        () => `2026010100000${String(timestampCounter++).padStart(4, '0')}`
    );
    mocks.listDirs.mockImplementation((dirPath: string) => [...new Set(Object.keys(disk)
        .filter(path => path.startsWith(`${dirPath}/`))
        .map(path => path.slice(dirPath.length + 1).split('/')[0]!))]);
    mocks.readDir.mockImplementation((dirPath: string, fileToRead?: (name: string) => string) => {
        const files: {[key: string]: {dir: string, content: string}} = {};
        const children = new Set(Object.keys(disk)
            .filter(path => path.startsWith(`${dirPath}/`))
            .map(path => path.slice(dirPath.length + 1).split('/')[0]!));
        for (const child of children) {
            const filePath = fileToRead ? fileToRead(child) : child;
            const content = disk[`${dirPath}/${filePath}`];
            if (content === undefined) continue;
            files[filePath] = {dir: child, content};
        }
        return files;
    });
});

describe('getSessionDir', () => {

    test('puts a sub loop into the temporary folder whatever its role is', () => {
        expect(SessionService.getSessionDir('agent', 'a1', 'p1', {
            kind: 'sub', runId: 'sub9', permissionWhiteList: new Set(),
        }))
            .toBe('/tmp/.deepclaw/subloop/sub9');
    });

    /** One folder per run, and never the folder of the session the run was spawned out of. */
    test('gives a task loop a run folder of its own', () => {
        expect(SessionService.getSessionDir('project', 'a1', 'p1', {
            kind: 'task', runId: 'task7', permissionWhiteList: new Set(),
        }))
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
        expect(meta.runtime.usage).toEqual({cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3});
        expect(meta.runtime.turnCount).toBe(0);
        expect(meta.runtime.finalText).toBe('');
    });

    test('goes on saying the history is in the old protocol until it has been migrated', () => {
        const sessionDir = nextSessionDir();
        disk[metaPath(sessionDir)] = JSON.stringify(newMeta({llmProtocol: 'OpenAIChat'}));
        const context = newTestContext({sessionDir});
        SessionService.loadSession({
            sessionDir, agentId: 'a1', projectId: '', loopId: 'agent.a1',
            loopKind: 'main' as const, llmProtocol: 'Anthropic',
        });
        SessionService.updateSessionRuntime(context, {});
        expect(persistedMeta(sessionDir).llmProtocol).toBe('OpenAIChat');
    });

    test('says the new protocol once the history has been migrated into it', () => {
        const sessionDir = nextSessionDir();
        disk[metaPath(sessionDir)] = JSON.stringify(newMeta({llmProtocol: 'OpenAIChat'}));
        const context = newTestContext({sessionDir});
        SessionService.loadSession({
            sessionDir, agentId: 'a1', projectId: '', loopId: 'agent.a1',
            loopKind: 'main' as const, llmProtocol: 'Anthropic',
        });
        SessionService.markHistoryProtocol(context, 'Anthropic');
        expect(persistedMeta(sessionDir).llmProtocol).toBe('Anthropic');
    });

    test('asks for the migration again when the one before it never finished', () => {
        const sessionDir = nextSessionDir();
        disk[metaPath(sessionDir)] = JSON.stringify(newMeta({llmProtocol: 'OpenAIChat'}));
        const config = {
            sessionDir, agentId: 'a1', projectId: '', loopId: 'agent.a1',
            loopKind: 'main' as const, llmProtocol: 'Anthropic' as const,
        };
        // A stop landing in the summarizing call: the session was loaded, nothing was migrated,
        // and the loop the gateway builds in its place reads the session over again.
        SessionService.loadSession(config);
        expect(SessionService.loadSession(config).outdated).toBe(true);
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

    test('writes the file over again when a compaction left fewer messages than it holds', () => {
        const context = startSession();
        context.runtime.turnCount = 1;
        context.runtime.historyPersistIndex = 20;
        SessionService.saveHistory([{i: 1}], context);
        expect(mocks.writeFile).toHaveBeenCalledWith(historyPath(context), '{"i":1}\n');
        expect(context.runtime.historyPersistIndex).toBe(1);
    });

    test('leaves the file alone when it already holds every message', () => {
        const context = startSession();
        context.runtime.turnCount = 1;
        context.runtime.historyPersistIndex = 2;
        SessionService.saveHistory([{i: 1}, {i: 2}], context, {}, true);
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
        expect(statusOf({transitionReason: 'toolUse', agentBreakReason: 'projectCreated'})).toBe('paused');
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

describe('nameSession', () => {

    test('names the conversation after the first thing asked of it', () => {
        const context = startSession();
        SessionService.nameSession(context, 'find out why the build is slow');
        expect(persistedMeta(context.sessionDir).runtime.name)
            .toBe('find out why the build is slow');
    });

    /**
     * A name that followed the latest question would rename the conversation out from under whoever
     * was looking for it, and by the end of a long one it would say nothing about how it began.
     */
    test('keeps the name it was given when asked again', () => {
        const context = startSession();
        SessionService.nameSession(context, 'the first thing');
        SessionService.nameSession(context, 'the second thing');
        expect(persistedMeta(context.sessionDir).runtime.name).toBe('the first thing');
    });

    /** Everything after the first line of a question is the paste that came with it. */
    test('takes the first line of a question and nothing of what was pasted under it', () => {
        const context = startSession();
        SessionService.nameSession(context, 'what is wrong here?\n\nError: nope\n  at x\n  at y');
        expect(persistedMeta(context.sessionDir).runtime.name).toBe('what is wrong here?');
    });

    test('reads past the empty lines a message begins with', () => {
        const context = startSession();
        SessionService.nameSession(context, '\n  \nthe question itself');
        expect(persistedMeta(context.sessionDir).runtime.name).toBe('the question itself');
    });

    /** A question is asked in sentences, and the first of them is what it is about. */
    test('names the conversation after the first sentence of a long question', () => {
        const context = startSession();
        SessionService.nameSession(
            context, '为什么打包这么慢？我试过 --verbose，看起来卡在 sourcemap 那一步，但是不确定。'
        );
        expect(persistedMeta(context.sessionDir).runtime.name).toBe('为什么打包这么慢？');
    });

    test('takes the sentence of a latin question along with the mark that ends it', () => {
        const context = startSession();
        SessionService.nameSession(
            context, 'why is the build so slow? I tried --verbose and it seems to hang.'
        );
        expect(persistedMeta(context.sessionDir).runtime.name)
            .toBe('why is the build so slow?');
    });

    /** A conversation called `hi.` is one nobody finds again. */
    test('reads past a sentence too short to be a name', () => {
        const context = startSession();
        SessionService.nameSession(context, '你好。帮我看下打包为什么这么慢。剩下的以后再说。');
        expect(persistedMeta(context.sessionDir).runtime.name)
            .toBe('你好。帮我看下打包为什么这么慢。');
    });

    /**
     * The sentences of a line are only the ones that end, and the last thing asked in a line as
     * often as not ends with nothing at all. Read for its sentences alone, all this line has is the
     * hello in front of it.
     */
    test('keeps the whole of a line whose sentences do not add up to a name', () => {
        const context = startSession();
        SessionService.nameSession(context, '你好。帮我看下打包为什么这么慢');
        expect(persistedMeta(context.sessionDir).runtime.name)
            .toBe('你好。帮我看下打包为什么这么慢');
    });

    test('keeps the whole of a latin line that ends without a mark', () => {
        const context = startSession();
        SessionService.nameSession(context, 'hi. can you look at why the build is slow');
        expect(persistedMeta(context.sessionDir).runtime.name)
            .toBe('hi. can you look at why the build is slow');
    });

    /** Cut there, `session-service.ts` would end a sentence in the middle of a name. */
    test('does not end a sentence at a full stop a word carries on past', () => {
        const context = startSession();
        SessionService.nameSession(context, 'look at session-service.ts and tell me what is wrong.');
        expect(persistedMeta(context.sessionDir).runtime.name)
            .toBe('look at session-service.ts and tell me what is wrong.');
    });

    /** A comma carries the question on rather than ending it. */
    test('reads through the commas of a question', () => {
        const context = startSession();
        SessionService.nameSession(context, '帮我看下打包为什么这么慢，我怀疑是 sourcemap。');
        expect(persistedMeta(context.sessionDir).runtime.name)
            .toBe('帮我看下打包为什么这么慢，我怀疑是 sourcemap。');
    });

    /** It is read at a glance off a list one line wide, so a paragraph is not a name. */
    test('cuts a question that never ends a sentence', () => {
        const context = startSession();
        SessionService.nameSession(context, 'x'.repeat(500));
        expect(persistedMeta(context.sessionDir).runtime.name).toHaveLength(60);
    });

    test('cuts a question with no end to it between two of its words', () => {
        const context = startSession();
        SessionService.nameSession(context, `${'word '.repeat(30)}end`);
        const name = persistedMeta(context.sessionDir).runtime.name!;
        expect(name.length).toBeLessThanOrEqual(60);
        expect(name.endsWith('word')).toBe(true);
    });

    /** A sentence long enough to be a paragraph is still cut back to a line. */
    test('cuts a first sentence longer than a name is allowed to be', () => {
        const context = startSession();
        SessionService.nameSession(context, `${'x'.repeat(500)}。and then some more`);
        expect(persistedMeta(context.sessionDir).runtime.name).toHaveLength(60);
    });

    test('leaves a conversation begun without a word unnamed', () => {
        const context = startSession();
        SessionService.nameSession(context, '   \n  ');
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    test('does nothing for a session it never loaded', () => {
        const context = newTestContext({sessionDir: nextSessionDir()});
        SessionService.nameSession(context, 'nobody is listening');
        expect(mocks.writeFile).not.toHaveBeenCalled();
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

describe('archiveSession', () => {

    /** The loop id has to name the folder, since that is what archiving is asked by. */
    function startTalking(turnCount = 0): {context: OneLoopContext, loopId: string} {
        const sessionDir = nextSessionDir();
        const agentId = sessionDir.split('/')[1]!;
        const loopId = `agent.${agentId}`;
        const context = startSession({sessionDir, loopId, agentId, projectId: ''});
        // The folder is there either way. What a run left lying around in it is not a conversation.
        disk[`${sessionDir}/tool_results/r1.txt`] = 'the result of some tool call';
        if (turnCount > 0) {
            disk[`${sessionDir}/messages.jsonl`] = '{"i":1}\n';
            SessionService.saveHistory([], context, {turnCount});
        }
        return {context, loopId};
    }

    test('moves the whole session folder aside and names where it went', () => {
        const {context, loopId} = startTalking(3);
        const sessionId = SessionService.archiveSession(loopId);
        expect(sessionId).toBeDefined();
        expect(disk[`.agents/${context.agentId}/archived/${sessionId}/messages.jsonl`]).toBe('{"i":1}\n');
        expect(disk[`${context.sessionDir}/messages.jsonl`]).toBeUndefined();
    });

    /** What the user reads back has to be the transcript of the history the answers came out of. */
    test('takes the chat log along with the history', () => {
        const {context, loopId} = startTalking(3);
        disk[`${context.sessionDir}/chat.jsonl`] = '{"id":"m1"}\n';
        const sessionId = SessionService.archiveSession(loopId);
        expect(disk[`.agents/${context.agentId}/archived/${sessionId}/chat.jsonl`]).toBe('{"id":"m1"}\n');
    });

    test('leaves a conversation nothing was said in where it is', () => {
        const {loopId} = startTalking();
        expect(SessionService.archiveSession(loopId)).toBeUndefined();
        expect(mocks.movePath).not.toHaveBeenCalled();
    });

    /** Losing what somebody typed is worse than keeping a conversation of one line around. */
    test('keeps a conversation whose turn never ran', () => {
        const {context, loopId} = startTalking();
        disk[`${context.sessionDir}/chat.jsonl`] = '{"id":"m1"}\n';
        expect(SessionService.archiveSession(loopId)).toBeDefined();
    });

    test('says nothing went anywhere when there is no session at all', () => {
        expect(SessionService.archiveSession('agent.neverTalked')).toBeUndefined();
    });

    /**
     * Held on to, the metadata of the conversation that was closed would be read as the state of the
     * empty one taking its place, down to the tokens it had spent.
     */
    test('forgets what it knew about the conversation it closed', () => {
        const {loopId} = startTalking(3);
        SessionService.archiveSession(loopId);
        expect(SessionService.getTokenUsage(loopId)).toBeUndefined();
    });

    /** Stamped where the conversation now is, and only once it got there. */
    test('stamps the archived session as ended, in the folder it was moved to', () => {
        const {context, loopId} = startTalking(3);
        const writesBefore = mocks.writeFile.mock.calls.length;
        const sessionId = SessionService.archiveSession(loopId);
        const archived = `.agents/${context.agentId}/archived/${sessionId}`;
        expect(persistedMeta(archived).runtime.endedAt).toBeDefined();
        // Nothing is written where the conversation stood: stamped there, a move that then failed
        // would leave the session still being talked in marked as one that is over.
        expect(mocks.writeFile.mock.calls.slice(writesBefore)
            .some(([filePath]) => filePath === metaPath(context.sessionDir))).toBe(false);
    });

    /**
     * A folder that did not move is a conversation still open, and saying it closed is worse than
     * saying nothing: what asked would go on to empty the chat and build the loop from that history.
     */
    test('reports a session folder that would not move rather than answering with nothing', () => {
        const {loopId} = startTalking(3);
        mocks.movePath.mockReturnValueOnce(false);
        expect(() => SessionService.archiveSession(loopId)).toThrow('went missing');
    });

    test('leaves the session where it is when the move failed', () => {
        const {context, loopId} = startTalking(3);
        mocks.movePath.mockReturnValueOnce(false);
        expect(() => SessionService.archiveSession(loopId)).toThrow();
        expect(disk[`${context.sessionDir}/messages.jsonl`]).toBe('{"i":1}\n');
        expect(SessionService.getTokenUsage(loopId)).toBeDefined();
    });

    /** A turn that never finished still left the loop something it had been told. */
    test('keeps a session that has a history and no transcript', () => {
        const {context, loopId} = startTalking();
        disk[`${context.sessionDir}/messages.jsonl`] = '{"i":1}\n';
        expect(SessionService.archiveSession(loopId)).toBeDefined();
    });
});

describe('getArchivedSessionDir', () => {

    test('names the folder a conversation of this loop was moved to', () => {
        expect(SessionService.getArchivedSessionDir('agent.a1', '20260823142100123'))
            .toBe('.agents/a1/archived/20260823142100123');
    });

    /**
     * The id comes in from a browser and is about to be a path. Two dots would walk out of the
     * agent's own folder and read the live chat of another one.
     */
    test('refuses an id that would climb out of the folder it belongs to', () => {
        expect(() => SessionService.getArchivedSessionDir('agent.a1', '../../other/session'))
            .toThrow('Not a session id');
    });

    test('refuses a name that is not a timestamp', () => {
        expect(() => SessionService.getArchivedSessionDir('agent.a1', 'session'))
            .toThrow('Not a session id');
    });

    test('refuses an id dressed up as a timestamp with a path on the end', () => {
        expect(() => SessionService.getArchivedSessionDir('agent.a1', '20260823142100123/../..'))
            .toThrow('Not a session id');
    });
});

describe('listSessions', () => {

    /** Sessions are named after the moment they were closed, which is the order they are listed in. */
    const OLDER = '20260101120000000';
    const NEWER = '20260101130000000';

    function archived(agentId: string, sessionId: string, runtime: Record<string, unknown>): void {
        disk[`.agents/${agentId}/archived/${sessionId}/session.json`] = JSON.stringify({
            llmProtocol: 'Anthropic', agentId, projectId: '', loopId: `agent.${agentId}`,
            loopKind: 'main', messagesPath: '',
            runtime: {
                status: 'idle', turnCount: 1, updatedAt: '2026-01-01T00:00:00.000Z',
                usage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
                ...runtime,
            },
        });
    }

    test('answers with nothing when no conversation was ever closed', () => {
        expect(SessionService.listSessions('agent.listEmpty')).toEqual([]);
    });

    test('lists what each conversation was, the most recent one first', () => {
        archived('listTwo', OLDER, {turnCount: 2, finalText: 'the older one'});
        archived('listTwo', NEWER, {turnCount: 9, finalText: 'the newer one'});
        const sessions = SessionService.listSessions('agent.listTwo');
        expect(sessions.map(session => session.sessionId)).toEqual([NEWER, OLDER]);
        expect(sessions[0]).toMatchObject({turnCount: 9, finalText: 'the newer one'});
    });

    test('carries what each conversation was called', () => {
        archived('listNamed', OLDER, {name: 'why the build is slow'});
        expect(SessionService.listSessions('agent.listNamed')[0]?.name)
            .toBe('why the build is slow');
    });

    /** One closed before conversations had names is read back by the time it was had. */
    test('leaves a conversation that was never named without one', () => {
        archived('listUnnamed', OLDER, {});
        expect(SessionService.listSessions('agent.listUnnamed')[0]?.name).toBeUndefined();
    });

    /** A name written by a build that allowed a longer one is still shown on one line. */
    test('cuts a name longer than a name is allowed to be', () => {
        archived('listLongName', OLDER, {name: 'x'.repeat(500)});
        expect(SessionService.listSessions('agent.listLongName')[0]?.name).toHaveLength(60);
    });

    test('carries the token usage of each conversation', () => {
        archived('listUsage', OLDER, {
            usage: {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3},
        });
        expect(SessionService.listSessions('agent.listUsage')[0]?.usage)
            .toEqual({cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3});
    });

    test('answers with an empty summary text for a session that ended saying nothing', () => {
        archived('listSilent', OLDER, {finalText: undefined});
        expect(SessionService.listSessions('agent.listSilent')[0]?.finalText).toBe('');
    });

    /**
     * A list shows two lines of what a conversation ended with, and a run can end with a report of
     * thirty thousand characters. Sending every one of them to draw two lines makes opening the
     * list heavier with every conversation that was ever closed.
     */
    test('cuts the summary of a conversation down to what a list can show', () => {
        archived('listLong', OLDER, {finalText: 'x'.repeat(30000)});
        expect(SessionService.listSessions('agent.listLong')[0]?.finalText).toHaveLength(200);
    });

    /**
     * A conversation whose turn never ran has a transcript and no metadata at all, and it is
     * archived for exactly that reason: left off the list it would be unreachable for good.
     */
    test('lists a session that has nothing but a transcript', () => {
        disk[`.agents/listBare/archived/${OLDER}/chat.jsonl`] = '{"id":"m1"}\n';
        expect(SessionService.listSessions('agent.listBare')).toEqual([{
            sessionId: OLDER, startedAt: '2026-01-01T12:00:00.000Z',
            updatedAt: '2026-01-01T12:00:00.000Z', turnCount: 0, finalText: '',
            usage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
        }]);
    });

    test('lists a session whose metadata is not readable', () => {
        archived('listBroken', OLDER, {});
        disk[`.agents/listBroken/archived/${NEWER}/session.json`] = 'not json';
        const sessions = SessionService.listSessions('agent.listBroken');
        expect(sessions.map(session => session.sessionId)).toEqual([NEWER, OLDER]);
        expect(sessions[0]?.turnCount).toBe(0);
    });

    /** One that would be refused the moment it was clicked is not worth offering. */
    test('leaves out a folder that is not named after a session', () => {
        archived('listStray', OLDER, {});
        disk['.agents/listStray/archived/notes/session.json'] = 'not json';
        expect(SessionService.listSessions('agent.listStray').map(session => session.sessionId))
            .toEqual([OLDER]);
    });

    /** The name a session was archived under is a timestamp, and so is the one thing always known. */
    test('reads the time a session was closed out of the name it was filed under', () => {
        disk['.agents/listTimed/archived/20260823142100123/chat.jsonl'] = '{"id":"m1"}\n';
        expect(SessionService.listSessions('agent.listTimed')[0]?.updatedAt)
            .toBe('2026-08-23T14:21:00.123Z');
    });

    test('resolves a project loop id to the sessions of the project', () => {
        disk[`.projects/listProject/archived/${OLDER}/session.json`] = JSON.stringify({
            runtime: {
                turnCount: 4, updatedAt: '2026-01-01T00:00:00.000Z',
                usage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
            },
        });
        expect(SessionService.listSessions('project.a1.listProject')[0]?.turnCount).toBe(4);
    });
});
