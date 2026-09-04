import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {
    type AgentHandler, type AgentInvokeOptions, type AgentInvokeResponse, type AgentRuntime,
    type CronTask, type WorkingDirRefusal
} from '@deepclaw/core';
import {type AgentConfig, type DeepclawConfig} from '@deepclaw/config';
import type {CarriedLoopState} from '@deepclaw/agent';
import {LoopGateway} from './loop-gateway';
import {
    isLoopStreamEvent, type InvokeSource, type LoopGatewayEvent, type LoopInfo
} from './loop-gateway-types';

/**
 * The gateway subscribes to cron once for the life of the process, so the call that carried the
 * subscriber is recorded in whichever test ran `initGateway` first and cleared away before the next.
 * Held here instead, where `clearAllMocks` does not reach.
 */
const cron = vi.hoisted(() => ({subscriber: undefined as ((task: unknown) => void) | undefined}));

const mocks = vi.hoisted(() => ({
    getLoop: vi.fn<(
        role: string, agentId: string, projectId: string, handler: AgentHandler,
        carried?: CarriedLoopState
    ) => unknown>(() => undefined),
    cronSubscribe: vi.fn<(cb: (task: CronTask) => void) => () => void>(cb => {
        cron.subscriber = cb as (task: unknown) => void;
        return () => undefined;
    }),
    mcpConnect: vi.fn(),
    getTokenUsage: vi.fn(),
    newAgentIdentity: vi.fn(),
    updateAgentIdentity: vi.fn(),
    getAgents: vi.fn(),
    getAgent: vi.fn<
        (id: string) => {id: string, fired: boolean, archivedDoneProjects?: number} | undefined
    >(),
    updateProject: vi.fn(),
    startProject: vi.fn<(id: string) => unknown>(
        (id: string) => ({id, startedAt: '2026-02-01T00:00:00.000Z'})
    ),
    archiveProject: vi.fn<(id: string) => unknown>(
        (id: string) => ({id, archivedAt: '2026-02-02T00:00:00.000Z'})
    ),
    listArchivedProjects: vi.fn<(ask: unknown) => unknown>(
        () => ({projects: [], owners: [], total: 0})
    ),
    restoreArchivedProject: vi.fn<(id: string) => unknown>(
        (id: string) => ({id, title: 'Ship it', tasks: {}})
    ),
    deleteArchivedProject: vi.fn<(id: string) => unknown>((id: string) => ({id, creator: 'a1'})),
    updateTask: vi.fn(),
    finishTask: vi.fn(),
    editTaskReport: vi.fn(),
    editProjectReport: vi.fn(),
    setWorkingDir: vi.fn<
        (id: string, dir: string, create?: boolean) => WorkingDirRefusal | undefined
    >(),
    workingDirOf: vi.fn<(id: string) => string | undefined>(),
    getTask: vi.fn<(projectId: string, taskId: string) => unknown>(() => ({id: 't1', status: 'todo'})),
    getProjectDetail: vi.fn(),
    getProjectList: vi.fn(),
    getSkillList: vi.fn(),
    updateSkillAgents: vi.fn(),
    removeSkill: vi.fn(),
    getRunningTasks: vi.fn<() => unknown[]>(() => []),
    isRunning: vi.fn<(projectId: string, taskId: string) => boolean>(() => false),
    getAgentRuntimeStatus: vi.fn<(agentId: string) => unknown>(() => ({mood: 'none', emotions: []})),
    updateAgentRuntimeStatus: vi.fn<(agentId: string, mood?: string, emotion?: string) => unknown>(
        () => ({mood: 'none', emotions: []})
    ),
    getCronTasks: vi.fn<() => unknown[]>(() => []),
    getCronHistories: vi.fn(),
    updateCronTaskStatus: vi.fn(),
    updateCronTask: vi.fn(),
    clearAwayUser: vi.fn<(loopId: string) => void>(),
    addMessage: vi.fn(),
    replaceMessage: vi.fn(),
    archiveSession: vi.fn<(loopId: string) => string | undefined>(() => 'archived1'),
    listSessions: vi.fn<() => unknown[]>(() => []),
    hasRunningCommand: vi.fn<(loopId: string) => boolean>(() => false),
    forget: vi.fn<(loopId: string) => void>(),
    forgetProject: vi.fn<(projectId: string) => void>(),
    migrateLegacyChatFile: vi.fn<(loopId: string) => void>(),
    getOlderMessages: vi.fn<() => unknown[]>(() => []),
    saveImage: vi.fn<(bytes: Buffer, extension: string, loopId: string) => string>(
        (_bytes, extension, loopId) => `${loopId}/abc123.${extension}`
    ),
}));

vi.mock('@deepclaw/agent', () => ({
    LoopInitializer: {getLoop: mocks.getLoop},
    CronService: {
        subscribe: mocks.cronSubscribe,
        getCronTasks: mocks.getCronTasks,
        getCronHistories: mocks.getCronHistories,
        updateCronTaskStatus: mocks.updateCronTaskStatus,
        updateCronTask: mocks.updateCronTask,
    },
    MCPService: {connect: mocks.mcpConnect},
    SessionService: {
        getTokenUsage: mocks.getTokenUsage,
        archiveSession: mocks.archiveSession,
        listSessions: mocks.listSessions,
    },
    BackgroundCommandManager: {hasRunningCommand: mocks.hasRunningCommand},
    AgentIdentityManager: {
        newAgentIdentity: mocks.newAgentIdentity,
        updateAgentIdentity: mocks.updateAgentIdentity,
        getAgents: mocks.getAgents,
        getAgent: mocks.getAgent,
    },
    ProjectManager: {
        updateProject: mocks.updateProject,
        startProject: mocks.startProject,
        archiveProject: mocks.archiveProject,
        listArchivedProjects: mocks.listArchivedProjects,
        restoreArchivedProject: mocks.restoreArchivedProject,
        deleteArchivedProject: mocks.deleteArchivedProject,
        updateTask: mocks.updateTask,
        finishTask: mocks.finishTask,
        editTaskReport: mocks.editTaskReport,
        editProjectReport: mocks.editProjectReport,
        setWorkingDir: mocks.setWorkingDir,
        workingDirOf: mocks.workingDirOf,
        getTask: mocks.getTask,
        getProjectDetail: mocks.getProjectDetail,
        getProjectList: mocks.getProjectList,
    },
    SkillsManager: {
        getSkillList: mocks.getSkillList,
        updateSkillAgents: mocks.updateSkillAgents,
        removeSkill: mocks.removeSkill,
    },
    RunningTaskService: {
        getRunningTasks: mocks.getRunningTasks,
        isRunning: mocks.isRunning,
    },
    ToolUseService: {clearAwayUser: mocks.clearAwayUser},
    AGENTS_DIR: '.agents',
    PROJECT_DIR: '.projects',
    CHAT_FILE: 'chat.jsonl',
}));

vi.mock('./agent-runtime-service', () => ({
    AgentRuntimeService: {
        getStatus: mocks.getAgentRuntimeStatus,
        update: mocks.updateAgentRuntimeStatus,
    },
}));

vi.mock('./ui-chat-service', () => ({
    UIChatService: {
        addMessage: mocks.addMessage,
        replaceMessage: mocks.replaceMessage,
        forget: mocks.forget,
        forgetProject: mocks.forgetProject,
        migrateLegacyChatFile: mocks.migrateLegacyChatFile,
        getOlderMessages: mocks.getOlderMessages,
    },
}));

vi.mock('@deepclaw/i18n', () => ({i18nInstance: {t: (key: string) => key}}));

vi.mock('@deepclaw/node-utils', () => ({
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    ImageStore: {save: mocks.saveImage},
}));

const INTERACTION_TIMEOUT = 10 * 60 * 1000;

function newRuntime(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
    return {
        turnCount: 1,
        historyPersistIndex: 0,
        recoveryState: {maxTokenRetries: 0, inputMaxTokenRetries: 0, refusalState: ''},
        usage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
        ...overrides,
    };
}

/** A run that says no more than it answers with, which is most of what these tests need of one. */
function answered(text: string, said: string = text): AgentInvokeResponse {
    return {text, said, runtime: newRuntime()};
}

function newFakeLoop() {
    return {
        isOutdated: vi.fn(() => false),
        invoke: vi.fn<(input: string, options?: AgentInvokeOptions) => Promise<AgentInvokeResponse>>(
            async () => answered('reply')
        ),
        updateAgentConfig: vi.fn(),
        setExternalInterruptReason: vi.fn(),
        carriedState: vi.fn<() => CarriedLoopState>(
            () => ({permissionWhiteList: new Set(), footPrints: []})
        ),
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return {promise, resolve, reject};
}

function newAgentConfig(id: string): AgentConfig {
    return {
        id,
        name: 'Ada',
        mode: 'agent',
        im: {enabled: false},
        llm: {baseURL: 'https://api.example.com', apiKey: 'key', model: 'model'},
        multimodal: {},
    };
}

function newDeepclawConfig(agents: AgentConfig[]): DeepclawConfig {
    return {
        manager: {name: 'Deepclaw', title: 'CEO', avatar: '🐋'},
        agents,
        ui: {lang: 'en'},
        advanced: {},
    };
}

let seq = 0;
let currentLoop = newFakeLoop();
let events: LoopGatewayEvent[] = [];
let unsubscribe = () => undefined as unknown as boolean;

/** Every test works on its own agent so the gateway's static loop store cannot leak between tests. */
function nextLoop(role: 'agent' | 'project' = 'agent', projectId?: string) {
    seq += 1;
    const agentId = `spec${seq}`;
    currentLoop = newFakeLoop();
    const loopInfo: LoopInfo = projectId ? {role, agentId, projectId} : {role, agentId};
    const loopId = projectId ? `${role}.${agentId}.${projectId}` : `${role}.${agentId}`;
    return {loopInfo, loopId, loop: currentLoop};
}

/** The stand-in the next build is handed, for a loop built again after it was let go of. */
function nextFakeLoop() {
    currentLoop = newFakeLoop();
    return currentLoop;
}

function busyEvents(list: LoopGatewayEvent[]): LoopGatewayEvent[] {
    return list.filter(event => event.eventType === 'busy');
}

function capturedHandler(): AgentHandler {
    return mocks.getLoop.mock.calls.at(-1)![3];
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLoop.mockImplementation(() => currentLoop);
    mocks.getAgent.mockImplementation(id => ({id, fired: false}));
    mocks.isRunning.mockReturnValue(false);
    mocks.getTask.mockReturnValue({id: 't1', status: 'todo'});
    mocks.replaceMessage.mockImplementation((_loopId: string, id: string, content: string) => ({
        id, agentId: 'a1', content, type: 'agent', timestamp: '2026-01-01T00:00:00.000Z'
    }));
    events = [];
    unsubscribe = LoopGateway.subscribe(event => {
        events.push(event);
    }) as unknown as typeof unsubscribe;
});

afterEach(() => {
    unsubscribe();
    vi.useRealTimers();
});

describe('subscribe', () => {

    test('delivers events until the subscriber leaves', () => {
        const seen: LoopGatewayEvent[] = [];
        const off = LoopGateway.subscribe(event => seen.push(event));
        LoopGateway.fireBusyEvent('agent.unknown');
        off();
        LoopGateway.fireBusyEvent('agent.unknown');
        expect(busyEvents(seen)).toHaveLength(1);
        expect(busyEvents(events)).toHaveLength(2);
    });

    test('reports an unknown loop as idle', () => {
        LoopGateway.fireBusyEvent('agent.unknown');
        expect(events).toContainEqual({eventType: 'busy', loopId: 'agent.unknown', busy: false});
    });
});

describe('initGateway', () => {

    test('subscribes to cron once and forwards the task updates', () => {
        LoopGateway.initGateway();
        LoopGateway.initGateway();
        expect(mocks.cronSubscribe).toHaveBeenCalledOnce();
        expect(mocks.mcpConnect).toHaveBeenCalledOnce();

        const task = {id: 'c1', title: 'nightly'} as CronTask;
        mocks.cronSubscribe.mock.calls[0]![0](task);
        expect(events).toContainEqual({eventType: 'updateCron', content: task});
    });
});

describe('initLoop', () => {

    test('creates the loop only once per loopId', () => {
        const {loopId} = nextLoop();
        LoopGateway.initLoop(loopId);
        LoopGateway.initLoop(loopId);
        expect(mocks.getLoop).toHaveBeenCalledOnce();
    });

    test('splits the loopId into role, agent and project', () => {
        const {loopId, loopInfo} = nextLoop('project', 'p1');
        LoopGateway.initLoop(loopId);
        expect(mocks.getLoop)
            .toHaveBeenCalledWith('project', loopInfo.agentId, 'p1', expect.anything(), undefined);
    });

    test('broadcasts plain stream text but swallows tagged text', () => {
        const {loopId} = nextLoop();
        LoopGateway.initLoop(loopId);
        const handler = capturedHandler();
        handler.onStreamText({eventType: 'stream', loopId, browserId: 'b1', text: 'visible'});
        handler.onStreamText({eventType: 'stream', loopId, browserId: 'b1', text: 'hidden', tag: 'thinking'});
        expect(events.filter(isLoopStreamEvent).map(event => event.text)).toEqual(['visible']);
    });

    test('prefers the given stream handler over the broadcasting one', () => {
        const {loopId} = nextLoop();
        const onStreamText = vi.fn();
        LoopGateway.initLoop(loopId, {onStreamText});
        capturedHandler().onStreamText({eventType: 'stream', loopId, browserId: 'b1', text: 'private'});
        expect(onStreamText).toHaveBeenCalledOnce();
        expect(events.filter(isLoopStreamEvent)).toEqual([]);
    });

    test('always broadcasts info events itself', () => {
        const {loopId} = nextLoop();
        LoopGateway.initLoop(loopId, {onStreamText: vi.fn()});
        capturedHandler().onInfoEvent({eventType: 'updateAgent', content: {id: 'a1'}});
        expect(events).toContainEqual({eventType: 'updateAgent', content: {id: 'a1'}});
    });

    /**
     * A mood is nowhere on disk: the run reports what it felt, the gateway is what remembers it and
     * what tells the browsers the whole of it.
     */
    test('folds a reported feeling into the status it keeps', () => {
        const {loopId} = nextLoop();
        mocks.updateAgentRuntimeStatus.mockReturnValue({mood: 'happy', emotions: ['older', 'fresh']});
        LoopGateway.initLoop(loopId);
        capturedHandler().onInfoEvent({
            eventType: 'updateAgentRuntime', content: {agentId: 'a1', mood: 'happy', emotion: 'fresh'},
        });
        expect(mocks.updateAgentRuntimeStatus).toHaveBeenCalledExactlyOnceWith('a1', 'happy', 'fresh');
        expect(events).toContainEqual({
            eventType: 'updateAgentRuntime',
            content: {agentId: 'a1', mood: 'happy', emotions: ['older', 'fresh'], emotion: 'fresh'},
        });
    });
});

/**
 * Letting go of the loops nobody is using, so that a history apiece does not sit in memory for as
 * long as the process runs.
 *
 * Nothing here counts what is in the store. The store is static and holds whatever the tests above
 * left in it, so age is what an eviction is watched on instead: a loop built with the clock turned
 * back is the idlest one in there whatever else is, and twelve builds after it are more than the
 * store keeps, so by the end of them it cannot still be there. What says it was let go of is having
 * to be built a second time.
 */
describe('eviction', () => {
    const MAX_LIVE_LOOPS = 12;
    const LONG_AGO = Date.UTC(2020, 0, 1);
    let aged = 0;
    /** Loops left held back would hold the eviction of every test below this one back with them. */
    const releases: (() => void)[] = [];

    afterEach(() => {
        releases.splice(0).forEach(release => release());
    });

    function atTime(when: number, build: () => void): void {
        const clock = vi.spyOn(Date, 'now').mockReturnValue(when);
        try {
            build();
        } finally {
            clock.mockRestore();
        }
    }

    function idlestLoop() {
        const loop = nextLoop();
        aged += 1;
        atTime(LONG_AGO + aged, () => LoopGateway.initLoop(loop.loopId));
        return loop;
    }

    function fillStore(): string[] {
        return Array.from({length: MAX_LIVE_LOOPS}, () => {
            const {loopId} = nextLoop();
            LoopGateway.initLoop(loopId);
            return loopId;
        });
    }

    function wasRebuilt(loopId: string): boolean {
        mocks.getLoop.mockClear();
        LoopGateway.initLoop(loopId);
        return mocks.getLoop.mock.calls.length === 1;
    }

    function holdBusy(loopId: string): void {
        LoopGateway.fireBusyEvent(loopId, true);
        releases.push(() => LoopGateway.fireBusyEvent(loopId, false));
    }

    test('lets go of the idlest loop to make room for the ones after it', () => {
        const idle = idlestLoop();
        const filled = fillStore();
        expect(wasRebuilt(idle.loopId)).toBe(true);
        expect(wasRebuilt(filled.at(-1)!)).toBe(false);
    });

    test('keeps a loop with a run going, idlest as it may be', () => {
        const held = idlestLoop();
        holdBusy(held.loopId);
        const alsoIdle = idlestLoop();
        fillStore();
        expect(LoopGateway.isLoopBusy(held.loopId)).toBe(true);
        // The one beside it says the pass really did run and would have taken this one too.
        expect(wasRebuilt(alsoIdle.loopId)).toBe(true);
    });

    /**
     * What a browser reads is `running`, and that can be put down while the run it stood for is
     * still on its way out. The invoke of that run is what holds the loop here.
     */
    test('keeps a loop whose run has not been cleared away yet', () => {
        const held = idlestLoop();
        const invoked = deferred<AgentInvokeResponse>();
        held.loop.invoke.mockReturnValue(invoked.promise);
        aged += 1;
        atTime(LONG_AGO + aged, () => LoopGateway.invoke(
            held.loopInfo, {source: 'web', browserId: 'b1'}, 'hi'
        ));
        LoopGateway.fireBusyEvent(held.loopId, false);
        releases.push(() => invoked.resolve(answered('done')));
        const alsoIdle = idlestLoop();
        fillStore();
        expect(wasRebuilt(held.loopId)).toBe(false);
        expect(wasRebuilt(alsoIdle.loopId)).toBe(true);
    });

    test('keeps a loop that is waiting on an answer', async () => {
        const held = idlestLoop();
        const answer = capturedHandler().onInteractionEvent({
            eventType: 'interaction', loopId: held.loopId, browserId: 'b1',
            type: 'input', content: 'your name?',
        });
        const alsoIdle = idlestLoop();
        fillStore();
        expect(wasRebuilt(held.loopId)).toBe(false);
        expect(wasRebuilt(alsoIdle.loopId)).toBe(true);
        LoopGateway.cancelInteraction('b1', held.loopId, 'disconnected');
        await expect(answer).rejects.toBe('disconnected');
    });

    /** The limit is soft, and a loop that is being used is worth more than the limit is. */
    test('lets the store climb past the limit while every loop in it is held back', () => {
        const held = Array.from({length: MAX_LIVE_LOOPS}, () => {
            const {loopId} = idlestLoop();
            holdBusy(loopId);
            return loopId;
        });
        LoopGateway.initLoop(nextLoop().loopId);
        expect(held.filter(loopId => !LoopGateway.isLoopBusy(loopId))).toEqual([]);
    });

    /**
     * No fourth gate for a background command, which is what `startNewSession` needs one for: that
     * moves the session folder the command is writing into, and nothing here touches the folder. The
     * command is filed under the loopId in a store of its own, so the loop built next drains its
     * result all the same.
     */
    test('lets go of an idle loop that has a background command running', () => {
        mocks.hasRunningCommand.mockReturnValue(true);
        releases.push(() => mocks.hasRunningCommand.mockReturnValue(false));
        const idle = idlestLoop();
        fillStore();
        expect(wasRebuilt(idle.loopId)).toBe(true);
    });

    test('hands what the loop it let go of was holding to the one built in its place', () => {
        const idle = idlestLoop();
        const carried: CarriedLoopState = {
            permissionWhiteList: new Set(['file']),
            lastInputTokens: 4200,
            footPrints: [{type: 'read_file', content: 'notes.md'}],
        };
        idle.loop.carriedState.mockReturnValue(carried);
        fillStore();
        mocks.getLoop.mockClear();
        LoopGateway.initLoop(idle.loopId);
        expect(mocks.getLoop.mock.calls.at(-1)![4]).toBe(carried);
    });

    /**
     * A handover waits for a loop that may never be built again, so the waiting is counted too.
     * Every build past a full store lets one more loop go and sets aside what it was holding, so
     * twice the live limit of them is enough to push out whatever was set aside first -- whatever
     * the tests above left in there, which can only bring that moment closer.
     */
    test('lets go of the longest waiting handover once too many are waiting at once', () => {
        const idle = idlestLoop();
        idle.loop.carriedState.mockReturnValue({
            permissionWhiteList: new Set(['file']), footPrints: []
        });
        fillStore();
        Array.from({length: MAX_LIVE_LOOPS * 2}, () => LoopGateway.initLoop(nextLoop().loopId));
        mocks.getLoop.mockClear();
        LoopGateway.initLoop(idle.loopId);
        expect(mocks.getLoop.mock.calls.at(-1)![4]).toBeUndefined();
    });

    /** A new conversation is not the one those permissions were granted in. */
    test('drops what it set aside once that conversation is closed', () => {
        const idle = idlestLoop();
        idle.loop.carriedState.mockReturnValue({
            permissionWhiteList: new Set(['file']), footPrints: []
        });
        fillStore();
        expect(LoopGateway.startNewSession(idle.loopId).started).toBe(true);
        mocks.getLoop.mockClear();
        LoopGateway.initLoop(idle.loopId);
        expect(mocks.getLoop.mock.calls.at(-1)![4]).toBeUndefined();
    });

    /**
     * The rebuild of a loop pointed at another provider goes through the same factory, and that one
     * is meant to start over: the permissions were given for a conversation held with somebody else.
     */
    test('gives nothing to a loop built again for having gone stale', async () => {
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockResolvedValue(answered('done'));
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'first');
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(loopId)).toBe(false));
        loop.isOutdated.mockReturnValue(true);
        mocks.getLoop.mockClear();
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'second');
        expect(mocks.getLoop.mock.calls.at(-1)![4]).toBeUndefined();
    });

    test('walks past a loop it let go of when a new config comes in', () => {
        const idle = idlestLoop();
        fillStore();
        const agentConfig = newAgentConfig(idle.loopInfo.agentId);
        LoopGateway.updateConfig(newDeepclawConfig([agentConfig]));
        expect(idle.loop.updateAgentConfig).not.toHaveBeenCalled();
        // The loop built in its place is the one the next config reaches, and it read the config of
        // the moment for itself on the way up.
        const rebuilt = nextFakeLoop();
        LoopGateway.initLoop(idle.loopId);
        LoopGateway.updateConfig(newDeepclawConfig([agentConfig]));
        expect(rebuilt.updateAgentConfig).toHaveBeenCalledWith(agentConfig);
    });
});

describe('invoke', () => {

    test('marks the loop busy and announces it', () => {
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockReturnValue(deferred<AgentInvokeResponse>().promise);
        expect(LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi').busy).toBe(false);
        expect(LoopGateway.isLoopBusy(loopId)).toBe(true);
        expect(events).toContainEqual({eventType: 'busy', loopId, busy: true});
    });

    /** The busy event only reaches whoever watches that loop, a page watching none needs the list. */
    test('names the working loops to whoever watches no loop', async () => {
        const {loopInfo, loopId, loop} = nextLoop();
        const invoked = deferred<AgentInvokeResponse>();
        loop.invoke.mockReturnValue(invoked.promise);
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        expect(LoopGateway.getBusyLoops()).toContain(loopId);
        expect(events).toContainEqual({
            eventType: 'updateBusyLoops', content: expect.arrayContaining([loopId])
        });
        invoked.resolve(answered('done'));
        await vi.waitFor(() => expect(LoopGateway.getBusyLoops()).not.toContain(loopId));
        expect(events.at(-1)).toEqual({
            eventType: 'updateBusyLoops', content: expect.not.arrayContaining([loopId])
        });
    });

    test('opens an empty agent message for the answer', () => {
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockReturnValue(deferred<AgentInvokeResponse>().promise);
        const {msgId} = LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        expect(mocks.addMessage).toHaveBeenCalledWith(loopId, expect.objectContaining({
            id: msgId, content: '', type: 'agent'
        }));
        expect(events).toContainEqual(expect.objectContaining({eventType: 'chat', update: false}));
    });

    test('answers with the busy hint while the loop is still running', () => {
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockReturnValue(deferred<AgentInvokeResponse>().promise);
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        const second = LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'again');
        expect(second.busy).toBe(true);
        expect(loop.invoke).toHaveBeenCalledOnce();
        expect(mocks.replaceMessage).toHaveBeenCalledWith(loopId, second.msgId, 'gateway.busy');
    });

    test('writes the answer into the message and frees the loop', async () => {
        const {loopInfo, loopId, loop} = nextLoop();
        const invoked = deferred<AgentInvokeResponse>();
        loop.invoke.mockReturnValue(invoked.promise);
        const onDone = vi.fn();
        const {msgId} = LoopGateway.invoke(
            loopInfo, {source: 'web', browserId: 'b1'}, 'hi', undefined, onDone
        );
        invoked.resolve(answered('final answer'));
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(loopId)).toBe(false));
        expect(mocks.replaceMessage).toHaveBeenCalledWith(loopId, msgId, 'final answer');
        expect(onDone).toHaveBeenCalledWith('final answer');
        expect(busyEvents(events).at(-1))
            .toEqual({eventType: 'busy', loopId, busy: false, endedFor: 'b1'});
    });

    /**
     * The chat and the caller are one reader here: a terminal prints the run as it comes and then
     * prints what it is handed in place of it. Given the answer, the run it just watched would come
     * off the screen at the end of it, and the conversation would read one way in the terminal and
     * another way in the browser.
     */
    // 看着这轮跑完的人，屏幕上留下的和聊天里落的是同一段
    test('hands a caller that watched the run the whole of it, as the chat has it', async () => {
        const {loopInfo, loopId, loop} = nextLoop();
        const onDone = vi.fn();
        loop.invoke.mockResolvedValue(answered('final answer', 'a long way there\n\nfinal answer'));
        const {msgId} = LoopGateway.invoke(loopInfo, {source: 'tui'}, 'hi', undefined, onDone);
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(loopId)).toBe(false));
        expect(mocks.replaceMessage)
            .toHaveBeenCalledWith(loopId, msgId, 'a long way there\n\nfinal answer');
        expect(onDone).toHaveBeenCalledWith('a long way there\n\nfinal answer');
    });

    /** 镜像回聊天的那条 im 消息，还是 im 用户读到的那句 */
    test('marks an answer that came through im', async () => {
        const {loopInfo, loopId, loop} = nextLoop();
        const onDone = vi.fn();
        loop.invoke.mockResolvedValue(answered('final answer', 'a long way there\n\nfinal answer'));
        const {msgId} = LoopGateway.invoke(loopInfo, {source: 'im'}, 'hi', undefined, onDone);
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(loopId)).toBe(false));
        expect(mocks.replaceMessage).toHaveBeenCalledWith(loopId, msgId, '📱 final answer');
        expect(onDone).toHaveBeenCalledWith('final answer');
    });

    /** Nobody in a browser is waiting on it: a run from IM is answered where it was asked. */
    test('names no browser on the end of a run that came through im', async () => {
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockResolvedValue(answered('final answer'));
        LoopGateway.invoke(loopInfo, {source: 'im'}, 'hi');
        await vi.waitFor(() => expect(busyEvents(events).at(-1))
            .toEqual({eventType: 'busy', loopId, busy: false}));
    });

    test('publishes the token usage of the session when there is one', async () => {
        const usage = {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3};
        mocks.getTokenUsage.mockReturnValue(usage);
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockResolvedValue(answered('done'));
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        await vi.waitFor(() => expect(events).toContainEqual({eventType: 'tokenUsage', loopId, usage}));
    });

    test('reports a failed invoke and frees the loop', async () => {
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockRejectedValue(new Error('llm exploded'));
        const onDone = vi.fn();
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi', undefined, onDone);
        await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith('llm exploded'));
        expect(LoopGateway.isLoopBusy(loopId)).toBe(false);
    });

    /**
     * The answer is handed out first and written down after, so a write that fails arrives with
     * the caller already told. Left to throw it would reach the branch that reports a failure,
     * and an im user would read the answer and then, under it, be told the turn failed.
     */
    test('does not report a failure over an answer it already gave', async () => {
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockResolvedValue(answered('final answer'));
        mocks.replaceMessage.mockImplementation(() => {
            throw new Error('the chat file is gone');
        });
        const onDone = vi.fn();
        LoopGateway.invoke(loopInfo, {source: 'im'}, 'hi', undefined, onDone);
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(loopId)).toBe(false));
        expect(onDone).toHaveBeenCalledExactlyOnceWith('final answer');
    });

    test('frees the loop even when writing the answer down fails', async () => {
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockResolvedValue(answered('final answer'));
        mocks.replaceMessage.mockImplementation(() => {
            throw new Error('the chat file is gone');
        });
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        await vi.waitFor(() => expect(busyEvents(events).at(-1))
            .toEqual({eventType: 'busy', loopId, busy: false, endedFor: 'b1'}));
        expect(LoopGateway.stop(loopId)).toBe(false);
    });

    test('keeps the bytes of an image and hands the loop a reference', () => {
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockReturnValue(deferred<AgentInvokeResponse>().promise);
        LoopGateway.invoke(
            loopInfo,
            {source: 'web', browserId: 'b1', images: [{url: 'data:image/png;base64,QUJD', mediaType: 'image/png'}]},
            'look'
        );
        expect(mocks.saveImage).toHaveBeenCalledExactlyOnceWith(Buffer.from('ABC'), 'png', loopId);
        expect(loop.invoke).toHaveBeenCalledWith('look', expect.objectContaining({
            images: [{url: `dcimg://${loopId}/abc123.png`, mediaType: 'image/png'}]
        }));
    });

    test('rebuilds an outdated loop before using it again', async () => {
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockResolvedValue(answered('done'));
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'first');
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(loopId)).toBe(false));
        loop.isOutdated.mockReturnValue(true);
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'second');
        expect(mocks.getLoop).toHaveBeenCalledTimes(2);
    });
});

/**
 * Ending a run that is going. Three things have to happen for a stop to be a stop rather than a
 * failure, and each is checked on its own here: none of them stands for the others.
 */
describe('stop', () => {

    function runningLoop(source: InvokeSource = 'web', browserId = 'b1') {
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockReturnValue(deferred<AgentInvokeResponse>().promise);
        LoopGateway.invoke(loopInfo, {source, browserId}, 'hi');
        return {loopInfo, loopId, loop};
    }

    function askOf(loopId: string, browserId: string): Promise<string> {
        return capturedHandler().onInteractionEvent({
            eventType: 'interaction', loopId, browserId, type: 'input', content: 'your name?'
        });
    }

    test('answers that there was nothing to stop while the loop sits idle', () => {
        const {loopId} = nextLoop();
        LoopGateway.initLoop(loopId);
        expect(LoopGateway.stop(loopId)).toBe(false);
    });

    test('answers that there was nothing to stop for a loop nobody ever built', () => {
        expect(LoopGateway.stop('agent.nobody')).toBe(false);
    });

    test('aborts the signal the run was handed', () => {
        const {loopId, loop} = runningLoop();
        const {abortSignal} = loop.invoke.mock.calls[0]![1]!;
        expect(abortSignal?.aborted).toBe(false);
        expect(LoopGateway.stop(loopId)).toBe(true);
        expect(abortSignal?.aborted).toBe(true);
    });

    /** The signal ends the waiting; this is what makes the ending read as a stop and not a fault. */
    test('leaves the loop the reason it words the ending with', () => {
        const {loopId, loop} = runningLoop();
        LoopGateway.stop(loopId);
        expect(loop.setExternalInterruptReason).toHaveBeenCalledExactlyOnceWith('userStopped');
    });

    /**
     * Really rejected rather than raced against the signal somewhere below. The waiting promise is
     * what clears the ten minute timer and forgets the resolver, so one left unsettled leaks both.
     */
    test('takes back the question the run waits on and forgets it', async () => {
        const {loopId} = runningLoop();
        const answer = askOf(loopId, 'b1');
        LoopGateway.stop(loopId);
        await expect(answer).rejects.toBe('userStopped');
        expect(LoopGateway.waitingQuestions().filter(question => question.loopId === loopId))
            .toEqual([]);
    });

    /**
     * Not one of the two reasons a question could be taken back with before. Absent marks the user
     * away and holds every later question of the run against a silence that was never theirs;
     * disconnected says there was nobody to ask. Here they were there and they said stop.
     */
    test('takes the question back as stopped rather than as unanswered or unreachable', async () => {
        const {loopId} = runningLoop();
        const answer = askOf(loopId, 'b1');
        LoopGateway.stop(loopId);
        await expect(answer).rejects.not.toBe('interactionAfk');
        await expect(answer).rejects.not.toBe('disconnected');
    });

    test('closes the dialog that is open on the question', async () => {
        const {loopId} = runningLoop();
        const answer = askOf(loopId, 'b1');
        LoopGateway.stop(loopId);
        expect(events).toContainEqual({eventType: 'cancelInteraction', loopId, browserId: 'b1'});
        await expect(answer).rejects.toBeDefined();
    });

    /**
     * A question outlives the tab it was put to and is handed on to whichever one asked for it
     * since, and the stop itself may come from a third tab entirely. Sent under the wrong id the
     * event matches no dialog: the open one would never close, over a run long finished.
     */
    test('closes the dialog of the browser holding the question, not of whoever stopped', async () => {
        const {loopId} = runningLoop();
        const answer = askOf(loopId, 'b1');
        LoopGateway.askAgainOf('b3', loopId);
        LoopGateway.stop(loopId);
        expect(events).toContainEqual({eventType: 'cancelInteraction', loopId, browserId: 'b3'});
        expect(events).not.toContainEqual({eventType: 'cancelInteraction', loopId, browserId: 'b1'});
        await expect(answer).rejects.toBeDefined();
    });

    /**
     * A run from IM is under a browser id no browser ever held, and it locks every web view of the
     * loop all the same. Checked against whoever asks, a stop would never reach this one.
     */
    test('stops a run that no browser ever started', () => {
        const {loopId, loop} = runningLoop('im', '');
        expect(LoopGateway.stop(loopId)).toBe(true);
        expect(loop.invoke.mock.calls[0]![1]!.abortSignal?.aborted).toBe(true);
    });

    test('does nothing the second time, the first press having done all of it', async () => {
        const {loopId} = runningLoop();
        const answer = askOf(loopId, 'b1');
        LoopGateway.stop(loopId);
        await expect(answer).rejects.toBeDefined();
        expect(() => LoopGateway.stop(loopId)).not.toThrow();
        expect(events.filter(event => event.eventType === 'cancelInteraction')).toHaveLength(1);
    });

    test('has nothing left to abort once the run is over', async () => {
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockResolvedValue(answered('done'));
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(loopId)).toBe(false));
        expect(LoopGateway.stop(loopId)).toBe(false);
    });
});

describe('startNewSession', () => {

    async function idleLoop() {
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockResolvedValue(answered('done'));
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(loopId)).toBe(false));
        return {loopInfo, loopId, loop};
    }

    test('closes the conversation and names the one it kept', async () => {
        const {loopId} = await idleLoop();
        expect(LoopGateway.startNewSession(loopId)).toEqual({started: true, sessionId: 'archived1'});
        expect(mocks.archiveSession).toHaveBeenCalledExactlyOnceWith(loopId);
    });

    test('says nothing was kept when there was nothing in the conversation', async () => {
        const {loopId} = await idleLoop();
        mocks.archiveSession.mockReturnValueOnce(undefined);
        expect(LoopGateway.startNewSession(loopId)).toEqual({started: true, sessionId: undefined});
    });

    /**
     * Without this the folder would be empty on disk while the loop went on answering out of the
     * history it still held in memory.
     */
    test('builds the loop again so the next turn starts from an empty history', async () => {
        const {loopId} = await idleLoop();
        LoopGateway.startNewSession(loopId);
        expect(mocks.getLoop).toHaveBeenCalledTimes(2);
    });

    test('forgets the transcript it was holding', async () => {
        const {loopId} = await idleLoop();
        LoopGateway.startNewSession(loopId);
        expect(mocks.forget).toHaveBeenCalledExactlyOnceWith(loopId);
    });

    /** Archiving one that still sat outside the session would hand it to the empty session next. */
    test('brings a transcript left beside the session in before archiving', async () => {
        const {loopId} = await idleLoop();
        LoopGateway.startNewSession(loopId);
        expect(mocks.migrateLegacyChatFile.mock.invocationCallOrder[0]!)
            .toBeLessThan(mocks.archiveSession.mock.invocationCallOrder[0]!);
    });

    test('tells every view of the loop that the conversation was closed', async () => {
        const {loopId} = await idleLoop();
        LoopGateway.startNewSession(loopId);
        expect(events).toContainEqual({eventType: 'sessionReset', loopId});
    });

    test('refuses while a run is going', () => {
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockReturnValue(deferred<AgentInvokeResponse>().promise);
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        expect(LoopGateway.startNewSession(loopId)).toEqual({started: false, reason: 'busy'});
        expect(mocks.archiveSession).not.toHaveBeenCalled();
    });

    /** Outliving the turn that started it is the whole point of a background command. */
    test('refuses while a background command is still writing into the session', async () => {
        const {loopId} = await idleLoop();
        mocks.hasRunningCommand.mockReturnValueOnce(true);
        expect(LoopGateway.startNewSession(loopId))
            .toEqual({started: false, reason: 'backgroundCommand'});
        expect(mocks.archiveSession).not.toHaveBeenCalled();
    });

    /**
     * The folder is still there with everything in it, so the conversation is still open. Told it
     * closed, the view would empty itself and the loop would be built from the history it never
     * stopped having: the user reads an empty chat while the agent remembers all of it.
     */
    test('refuses when the conversation could not be filed away', async () => {
        const {loopId} = await idleLoop();
        mocks.archiveSession.mockImplementationOnce(() => {
            throw new Error('the folder would not move');
        });
        expect(LoopGateway.startNewSession(loopId))
            .toEqual({started: false, reason: 'archiveFailed'});
    });

    test('leaves everything as it was when the conversation could not be filed away', async () => {
        const {loopId} = await idleLoop();
        mocks.getLoop.mockClear();
        mocks.archiveSession.mockImplementationOnce(() => {
            throw new Error('the folder would not move');
        });
        LoopGateway.startNewSession(loopId);
        expect(mocks.forget).not.toHaveBeenCalled();
        expect(mocks.getLoop).not.toHaveBeenCalled();
        expect(events).not.toContainEqual({eventType: 'sessionReset', loopId});
    });

    /** The folder has moved by the time the loop is built again, so there is nothing left to refuse. */
    test('still says the conversation was closed when the loop could not be built again', async () => {
        const {loopId} = await idleLoop();
        mocks.getLoop.mockImplementationOnce(() => {
            throw new Error('the agent is gone');
        });
        expect(LoopGateway.startNewSession(loopId)).toEqual({started: true, sessionId: 'archived1'});
        expect(events).toContainEqual({eventType: 'sessionReset', loopId});
    });

    /**
     * What must not survive is the loop still holding the conversation that was just closed: kept,
     * it would answer the next turn out of it and write that history into the session which took
     * its place. Losing the instance costs a build; keeping it costs the conversation.
     */
    test('drops a loop that could not be built again, for the next turn to build a clean one', async () => {
        const {loopInfo, loopId} = await idleLoop();
        mocks.getLoop.mockImplementationOnce(() => {
            throw new Error('the agent is gone');
        });
        LoopGateway.startNewSession(loopId);
        mocks.getLoop.mockClear();
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        expect(mocks.getLoop).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(loopId)).toBe(false));
    });

    /** Its session is in the temp folder and thrown away per run, so there is nothing to close. */
    test('refuses a cron run', () => {
        expect(LoopGateway.startNewSession('cron.a1.c1'))
            .toEqual({started: false, reason: 'unsupported'});
        expect(mocks.archiveSession).not.toHaveBeenCalled();
    });

    test('closes the conversation of a loop it never built', () => {
        expect(LoopGateway.startNewSession('agent.neverTalked').started).toBe(true);
        expect(mocks.getLoop).not.toHaveBeenCalled();
    });

    test('reads a page of a conversation that was closed', () => {
        mocks.getOlderMessages.mockReturnValueOnce([{id: 'm1'}]);
        expect(LoopGateway.getSessionMessages('agent.a1', 's1', 'm2')).toEqual([{id: 'm1'}]);
        expect(mocks.getOlderMessages).toHaveBeenCalledWith('agent.a1', 'm2', 's1');
    });

    /**
     * An empty name reads as the conversation being talked in everywhere below here, which would
     * walk past the check on the name and hand the live chat back dressed as an archived one.
     */
    test('refuses to read back without being told which conversation', () => {
        expect(() => LoopGateway.getSessionMessages('agent.a1', '')).toThrow('No session was named');
        expect(mocks.getOlderMessages).not.toHaveBeenCalled();
    });

    test('lists the conversations that were closed', () => {
        mocks.listSessions.mockReturnValueOnce([{sessionId: 's1'}]);
        expect(LoopGateway.listSessions('agent.a1')).toEqual([{sessionId: 's1'}]);
    });
});

describe('interactions', () => {

    function askQuestion(loopId: string, browserId = 'b1') {
        LoopGateway.initLoop(loopId);
        return capturedHandler().onInteractionEvent({
            eventType: 'interaction', loopId, browserId, type: 'input', content: 'your name?'
        });
    }

    test('broadcasts the question and resolves it with the answer', async () => {
        const {loopId} = nextLoop();
        const answer = askQuestion(loopId);
        expect(events).toContainEqual(expect.objectContaining({eventType: 'interaction', loopId}));
        expect(LoopGateway.resolveInteraction('b1', loopId, 'Ada')).toBe(true);
        await expect(answer).resolves.toBe('Ada');
    });

    test('reports that nobody is waiting for an answer', () => {
        expect(LoopGateway.resolveInteraction('b1', 'agent.nobody', 'Ada')).toBe(false);
    });

    test('takes an answer only from the browser the question is with', async () => {
        const {loopId} = nextLoop();
        const answer = askQuestion(loopId, 'b1');
        expect(LoopGateway.resolveInteraction('b2', loopId, 'from b2')).toBe(false);
        LoopGateway.resolveInteraction('b1', loopId, 'from b1');
        await expect(answer).resolves.toBe('from b1');
    });

    test('rejects a cancelled question with its reason', async () => {
        const {loopId} = nextLoop();
        const answer = askQuestion(loopId);
        LoopGateway.cancelInteraction('b1', loopId, 'disconnected');
        await expect(answer).rejects.toBe('disconnected');
    });

    /** A question no browser will ever be handed is not worth ten minutes of a run. */
    test('refuses a question of a run that has no browser behind it at once', async () => {
        const {loopId} = nextLoop();
        await expect(askQuestion(loopId, '')).rejects.toBe('disconnected');
        expect(events).not.toContainEqual(expect.objectContaining({eventType: 'interaction'}));
        expect(LoopGateway.pendingInteraction('', loopId)).toBeUndefined();
    });

    test('cancels a question that stayed unanswered for too long as an absent user', async () => {
        vi.useFakeTimers();
        const {loopId} = nextLoop();
        const answer = askQuestion(loopId);
        vi.advanceTimersByTime(INTERACTION_TIMEOUT);
        await expect(answer).rejects.toBe('interactionAfk');
        expect(events).toContainEqual({eventType: 'cancelInteraction', loopId, browserId: 'b1'});
    });

    test('forgets a question once it is answered', async () => {
        const {loopId} = nextLoop();
        const answer = askQuestion(loopId);
        LoopGateway.resolveInteraction('b1', loopId, 'Ada');
        await answer;
        expect(LoopGateway.resolveInteraction('b1', loopId, 'again')).toBe(false);
    });

    /** What a page that opens while the question waits is handed, having missed the event itself. */
    test('hands out the question a browser still owes an answer to', async () => {
        const {loopId} = nextLoop();
        const answer = askQuestion(loopId);
        expect(LoopGateway.pendingInteraction('b1', loopId)).toEqual({
            eventType: 'interaction', loopId, browserId: 'b1', type: 'input', content: 'your name?'
        });
        expect(LoopGateway.pendingInteraction('b2', loopId)).toBeUndefined();
        LoopGateway.resolveInteraction('b1', loopId, 'Ada');
        await answer;
        expect(LoopGateway.pendingInteraction('b1', loopId)).toBeUndefined();
    });

    test('lists what waits, with the browser each question waits for', async () => {
        const {loopId} = nextLoop();
        const answer = askQuestion(loopId, 'b1');
        expect(LoopGateway.waitingQuestions().filter(question => question.loopId === loopId))
            .toEqual([expect.objectContaining({loopId, browserId: 'b1', content: 'your name?'})]);
        LoopGateway.resolveInteraction('b1', loopId, 'Ada');
        await answer;
        expect(LoopGateway.waitingQuestions().filter(question => question.loopId === loopId))
            .toEqual([]);
    });

    /** The browser it was asked of is gone, and the run would otherwise wait out its ten minutes. */
    test('puts a question to another browser, which is then the one it takes an answer from', async () => {
        const {loopId} = nextLoop();
        const answer = askQuestion(loopId, 'b1');
        expect(LoopGateway.askAgainOf('b2', loopId)).toEqual({
            eventType: 'interaction', loopId, browserId: 'b2', type: 'input', content: 'your name?'
        });
        expect(LoopGateway.pendingInteraction('b2', loopId)).toBeDefined();
        expect(LoopGateway.pendingInteraction('b1', loopId)).toBeUndefined();
        expect(LoopGateway.resolveInteraction('b1', loopId, 'from b1')).toBe(false);
        LoopGateway.resolveInteraction('b2', loopId, 'from b2');
        await expect(answer).resolves.toBe('from b2');
    });

    test('has nothing to put to another browser once the question is answered', async () => {
        const {loopId} = nextLoop();
        const answer = askQuestion(loopId, 'b1');
        LoopGateway.resolveInteraction('b1', loopId, 'Ada');
        await answer;
        expect(LoopGateway.askAgainOf('b2', loopId)).toBeUndefined();
    });

    test('tells the browser a question ended up with that the waiting is over', async () => {
        vi.useFakeTimers();
        const {loopId} = nextLoop();
        const answer = askQuestion(loopId, 'b1');
        LoopGateway.askAgainOf('b2', loopId);
        vi.advanceTimersByTime(INTERACTION_TIMEOUT);
        await expect(answer).rejects.toBe('interactionAfk');
        expect(events).toContainEqual({eventType: 'cancelInteraction', loopId, browserId: 'b2'});
    });
});

describe('askedBrowser', () => {

    function runningLoop(source: InvokeSource = 'web', browserId = 'b1') {
        const {loopInfo, loopId, loop} = nextLoop();
        const invoked = deferred<AgentInvokeResponse>();
        loop.invoke.mockReturnValue(invoked.promise);
        LoopGateway.invoke(loopInfo, {source, browserId}, 'hi');
        return {loopId, invoked};
    }

    test('names the browser the questions of a run go to', () => {
        const {loopId} = runningLoop();
        expect(LoopGateway.askedBrowser(loopId)).toBe('b1');
    });

    /** A run started from a chat asks there, and no page is standing in for that chat. */
    test('answers with nothing for a run that asks somewhere else', () => {
        const {loopId} = runningLoop('im');
        expect(LoopGateway.askedBrowser(loopId)).toBeUndefined();
    });

    /** With no run on there is nobody being asked: the next run is asked for and asks by itself. */
    test('answers with nothing for a loop that is not running', async () => {
        const {loopId, invoked} = runningLoop();
        invoked.resolve(answered('done'));
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(loopId)).toBe(false));
        expect(LoopGateway.askedBrowser(loopId)).toBeUndefined();
    });

    test('answers with nothing for a loop it never heard of', () => {
        expect(LoopGateway.askedBrowser('agent.ghost')).toBeUndefined();
    });
});

/** The run gave up on asking after the silence, and somebody being there again undoes that. */
describe('askAgain', () => {

    test('lets the run of that loop ask again', () => {
        const {loopId} = nextLoop();
        LoopGateway.askAgain(loopId);
        expect(mocks.clearAwayUser).toHaveBeenCalledExactlyOnceWith(loopId);
    });
});

describe('updateConfig', () => {

    test('pushes the new config into the loops of that agent and reconnects mcp', () => {
        const {loopId, loopInfo} = nextLoop();
        LoopGateway.initLoop(loopId);
        const agentConfig = newAgentConfig(loopInfo.agentId);
        LoopGateway.updateConfig(newDeepclawConfig([agentConfig]));
        expect(currentLoop.updateAgentConfig).toHaveBeenCalledWith(agentConfig);
        expect(mocks.mcpConnect).toHaveBeenCalledOnce();
    });

    test('leaves the loops of other agents untouched', () => {
        const {loopId} = nextLoop();
        LoopGateway.initLoop(loopId);
        LoopGateway.updateConfig(newDeepclawConfig([newAgentConfig('someone-else')]));
        expect(currentLoop.updateAgentConfig).not.toHaveBeenCalled();
    });
});

describe('data updates', () => {

    const CLOSED = '2026-02-01T00:00:00.000Z';

    /** What the project manager hands back once the folder has moved. */
    function archived(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {id: 'p1', title: 'Ship it', archivedAt: '2026-02-02T00:00:00.000Z', ...overrides};
    }

    test('announces a newly hired agent with a neutral mood', () => {
        mocks.newAgentIdentity.mockReturnValue({id: 'a9', name: 'Ada', fired: false});
        const agent = LoopGateway.newAgentIdentity('a9');
        expect(agent.mood).toBe('none');
        expect(events).toContainEqual({eventType: 'updateAgent', content: agent});
    });

    test('announces an agent update after storing it', () => {
        LoopGateway.updateAgentIdentity({id: 'a9', name: 'Ada'});
        expect(mocks.updateAgentIdentity).toHaveBeenCalledWith({id: 'a9', name: 'Ada'});
        expect(events).toContainEqual({eventType: 'updateAgent', content: {id: 'a9', name: 'Ada'}});
    });

    test('announces new project tags', () => {
        LoopGateway.updateProjectTags('p1', ['urgent']);
        expect(mocks.updateProject).toHaveBeenCalledWith({id: 'p1', tags: ['urgent']});
        expect(events).toContainEqual({eventType: 'updateProject', content: {id: 'p1', tags: ['urgent']}});
    });

    /** What was written and not what came in: a long description is cut where it is written down. */
    test('announces the project description as it was stored', () => {
        mocks.updateProject.mockReturnValue({id: 'p1', description: 'a shop'});
        LoopGateway.updateProjectDescription('p1', '  a shop  ');
        expect(mocks.updateProject).toHaveBeenCalledWith({id: 'p1', description: '  a shop  '});
        expect(events).toContainEqual({
            eventType: 'updateProject', content: {id: 'p1', description: 'a shop'}
        });
    });

    /**
     * The one field rather than the whole project: a browser merges what it is handed, and a
     * project sent whole with no folder on it any more is a project whose folder every other tab
     * would go on showing.
     */
    test('announces the folder a project was given', () => {
        mocks.workingDirOf.mockReturnValue('/home/someone/code/app');
        expect(LoopGateway.setProjectWorkingDir('p1', '/home/someone/code/app')).toBeUndefined();
        expect(mocks.setWorkingDir)
            .toHaveBeenCalledWith('p1', '/home/someone/code/app', false);
        expect(events).toContainEqual({
            eventType: 'updateProject',
            content: {id: 'p1', workingDir: '/home/someone/code/app'},
        });
    });

    /** Null is how a browser is told a field is gone, absent leaving it as it was. */
    test('announces a folder taken off as nothing at all', () => {
        mocks.workingDirOf.mockReturnValue(undefined);
        LoopGateway.setProjectWorkingDir('p1', '');
        expect(events).toContainEqual({
            eventType: 'updateProject', content: {id: 'p1', workingDir: null}
        });
    });

    /**
     * A folder is made once the user has said so, and the browser is the one that can ask them.
     * Nothing is announced meanwhile: a path on the board under a question nobody has answered is
     * a path the project has not got.
     */
    test('says the folder is not there and announces nothing', () => {
        const refusal: WorkingDirRefusal = {reason: 'missing', dir: '/home/someone/typo'};
        mocks.setWorkingDir.mockReturnValue(refusal);
        expect(LoopGateway.setProjectWorkingDir('p1', '~/typo')).toBe(refusal);
        expect(events).not.toContainEqual(expect.objectContaining({
            content: expect.objectContaining({workingDir: expect.anything()}),
        }));
    });

    test('makes the folder for a browser that comes back with a yes', () => {
        mocks.workingDirOf.mockReturnValue('/home/someone/code/app');
        LoopGateway.setProjectWorkingDir('p1', '/home/someone/code/app', true);
        expect(mocks.setWorkingDir).toHaveBeenCalledWith('p1', '/home/someone/code/app', true);
    });

    /** Every browser hears it, so the start button goes from the tabs that were not pressed too. */
    test('announces a project the user started with the date it started on', () => {
        LoopGateway.startProject('p1');
        expect(mocks.startProject).toHaveBeenCalledWith('p1');
        expect(events).toContainEqual({
            eventType: 'updateProject', content: {id: 'p1', startedAt: '2026-02-01T00:00:00.000Z'}
        });
    });

    test('announces a project put away with the date it was put away on', () => {
        mocks.archiveProject.mockReturnValue({id: 'p1', archivedAt: '2026-02-02T00:00:00.000Z'});
        LoopGateway.archiveProject('p1');
        expect(mocks.archiveProject).toHaveBeenCalledWith('p1');
        expect(events).toContainEqual({
            eventType: 'updateProject', content: {id: 'p1', archivedAt: '2026-02-02T00:00:00.000Z'}
        });
    });

    /** The folder goes; that the work was done stays, on the agent that planned it. */
    test('counts a finished project on the agent that planned it as it is put away', () => {
        mocks.archiveProject.mockReturnValue(archived({creator: 'a1', closedAt: CLOSED}));
        mocks.getAgent.mockReturnValue({id: 'a1', fired: false, archivedDoneProjects: 2});
        LoopGateway.archiveProject('p1');
        expect(mocks.updateAgentIdentity).toHaveBeenCalledWith({id: 'a1', archivedDoneProjects: 3});
        expect(events).toContainEqual({
            eventType: 'updateAgent', content: {id: 'a1', archivedDoneProjects: 3}
        });
    });

    test('counts the first one for an agent whose soul file has never had a count', () => {
        mocks.archiveProject.mockReturnValue(archived({creator: 'a1', closedAt: CLOSED}));
        LoopGateway.archiveProject('p1');
        expect(mocks.updateAgentIdentity).toHaveBeenCalledWith({id: 'a1', archivedDoneProjects: 1});
    });

    /** Cleared away unfinished, which stood in no column anybody is remembered by. */
    test('counts nothing for a project put away before it was finished', () => {
        mocks.archiveProject.mockReturnValue(archived({creator: 'a1'}));
        LoopGateway.archiveProject('p1');
        expect(mocks.updateAgentIdentity).not.toHaveBeenCalled();
    });

    /** Asked for by whoever opened the archive, and pushed to nobody: it is off the board. */
    test('hands a look through the archive to the manager and answers with what it says', () => {
        const page = {projects: [{id: 'p1'}], owners: [{id: 'a1', count: 1}], total: 1};
        mocks.listArchivedProjects.mockReturnValue(page);
        const ask = {query: 'parser', owner: 'a1', offset: 20};
        expect(LoopGateway.listArchivedProjects(ask)).toBe(page);
        expect(mocks.listArchivedProjects).toHaveBeenCalledWith(ask);
        expect(events).toEqual([]);
    });

    /**
     * The whole row rather than a field of it: no page has heard of this project since it was put
     * away, so there is nothing on any board to patch.
     */
    test('announces the whole row of a project taken back out of the archive', () => {
        mocks.restoreArchivedProject.mockReturnValue({
            id: 'p1', title: 'Ship it', creator: 'a1', tasks: {t1: {id: 't1'}},
        });
        LoopGateway.restoreProject('p1');
        expect(mocks.restoreArchivedProject).toHaveBeenCalledWith('p1');
        expect(events).toContainEqual({eventType: 'updateProject', content: {
            id: 'p1', title: 'Ship it', creator: 'a1', taskCount: 1,
        }});
    });

    /** On the board again with its done column and all, and a count holding it would have it twice. */
    test('takes a project put back on the board off the count of finished ones put away', () => {
        mocks.restoreArchivedProject.mockReturnValue(
            {id: 'p1', creator: 'a1', closedAt: CLOSED, tasks: {}}
        );
        mocks.getAgent.mockReturnValue({id: 'a1', fired: false, archivedDoneProjects: 3});
        LoopGateway.restoreProject('p1');
        expect(mocks.updateAgentIdentity).toHaveBeenCalledWith({id: 'a1', archivedDoneProjects: 2});
    });

    test('takes nothing off the count for a project that was never finished', () => {
        mocks.restoreArchivedProject.mockReturnValue({id: 'p1', creator: 'a1', tasks: {}});
        mocks.getAgent.mockReturnValue({id: 'a1', fired: false, archivedDoneProjects: 3});
        LoopGateway.restoreProject('p1');
        expect(mocks.updateAgentIdentity).not.toHaveBeenCalled();
    });

    /** An archive that filled up before anything counted it holds projects no count is holding. */
    test('keeps the count at none where there was none to take from', () => {
        mocks.restoreArchivedProject.mockReturnValue(
            {id: 'p1', creator: 'a1', closedAt: CLOSED, tasks: {}}
        );
        mocks.getAgent.mockReturnValue({id: 'a1', fired: false});
        LoopGateway.restoreProject('p1');
        expect(mocks.updateAgentIdentity).toHaveBeenCalledWith({id: 'a1', archivedDoneProjects: 0});
    });

    test('takes nothing off the count of an agent who no longer works here', () => {
        mocks.restoreArchivedProject.mockReturnValue(
            {id: 'p1', creator: 'gone', closedAt: CLOSED, tasks: {}}
        );
        mocks.getAgent.mockReturnValue(undefined);
        LoopGateway.restoreProject('p1');
        expect(mocks.updateAgentIdentity).not.toHaveBeenCalled();
    });

    /**
     * Two windows on the archive and the other one got there first. The board has had this row
     * already, and the count it came off is not one to take from twice.
     */
    test('says nothing of a project the archive no longer holds', () => {
        mocks.restoreArchivedProject.mockReturnValue(undefined);
        mocks.getAgent.mockReturnValue({id: 'a1', fired: false, archivedDoneProjects: 3});
        LoopGateway.restoreProject('p1');
        expect(events.filter(event => event.eventType === 'updateProject')).toEqual([]);
        expect(mocks.updateAgentIdentity).not.toHaveBeenCalled();
    });

    test('says nothing of a project that could not be put back', () => {
        mocks.restoreArchivedProject.mockImplementationOnce(() => {
            throw new Error('Project p1 is on the board already.');
        });
        expect(() => LoopGateway.restoreProject('p1')).toThrow('is on the board already');
        expect(events.filter(event => event.eventType === 'updateProject')).toEqual([]);
        expect(mocks.updateAgentIdentity).not.toHaveBeenCalled();
    });

    /** No board has held this project since it was put away, so no board has anything to hear. */
    test('hands a project thrown away to the manager and tells no board of it', () => {
        LoopGateway.deleteArchivedProject('p1');
        expect(mocks.deleteArchivedProject).toHaveBeenCalledWith('p1');
        expect(events.filter(event => event.eventType === 'updateProject')).toEqual([]);
    });

    /** Nothing is left for that count to stand for: no row on a board, no folder on the disk. */
    test('takes a project thrown away off the count of finished ones put away', () => {
        mocks.deleteArchivedProject.mockReturnValue({id: 'p1', creator: 'a1', closedAt: CLOSED});
        mocks.getAgent.mockReturnValue({id: 'a1', fired: false, archivedDoneProjects: 3});
        LoopGateway.deleteArchivedProject('p1');
        expect(mocks.updateAgentIdentity).toHaveBeenCalledWith({id: 'a1', archivedDoneProjects: 2});
    });

    test('takes nothing off the count for an unfinished project thrown away', () => {
        mocks.deleteArchivedProject.mockReturnValue({id: 'p1', creator: 'a1'});
        mocks.getAgent.mockReturnValue({id: 'a1', fired: false, archivedDoneProjects: 3});
        LoopGateway.deleteArchivedProject('p1');
        expect(mocks.updateAgentIdentity).not.toHaveBeenCalled();
    });

    /** The other window threw it away first, and a count comes down once for one project. */
    test('takes nothing off the count for a project the archive no longer holds', () => {
        mocks.deleteArchivedProject.mockReturnValue(undefined);
        mocks.getAgent.mockReturnValue({id: 'a1', fired: false, archivedDoneProjects: 3});
        LoopGateway.deleteArchivedProject('p1');
        expect(mocks.updateAgentIdentity).not.toHaveBeenCalled();
    });

    test('counts nothing for a finished project whose agent no longer works here', () => {
        mocks.archiveProject.mockReturnValue(archived({creator: 'gone', closedAt: CLOSED}));
        mocks.getAgent.mockReturnValue(undefined);
        LoopGateway.archiveProject('p1');
        expect(mocks.updateAgentIdentity).not.toHaveBeenCalled();
    });

    /**
     * The folder has moved, so a chat that stayed would write the next message into the middle of a
     * file that is gone and a loop that stayed would answer out of a project nobody has. More than
     * one agent may have been talking about it, so this goes by the project.
     */
    test('lets go of every chat and loop of the project it put away', async () => {
        const first = nextLoop('project', 'p-gone');
        LoopGateway.invoke(first.loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(first.loopId)).toBe(false));
        const second = nextLoop('project', 'p-gone');
        LoopGateway.invoke(second.loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(second.loopId)).toBe(false));
        const built = mocks.getLoop.mock.calls.length;

        LoopGateway.archiveProject('p-gone');

        expect(mocks.forgetProject).toHaveBeenCalledWith('p-gone');
        // A loop that is no longer held is one built again by whatever reaches for it next, which is
        // how a dropped loop shows from out here.
        LoopGateway.invoke(first.loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        LoopGateway.invoke(second.loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        expect(mocks.getLoop.mock.calls.length).toBe(built + 2);
    });

    test('leaves the loops of other projects where they are', async () => {
        const other = nextLoop('project', 'p-other');
        LoopGateway.invoke(other.loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(other.loopId)).toBe(false));
        const built = mocks.getLoop.mock.calls.length;

        LoopGateway.archiveProject('p-gone');

        LoopGateway.invoke(other.loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        expect(mocks.getLoop.mock.calls.length).toBe(built);
    });

    /** The project leaves the manager, and the run coming back to it would find nothing there. */
    test('refuses to put away a project with a run going', () => {
        const {loopInfo, loop} = nextLoop('project', 'p-busy');
        loop.invoke.mockReturnValue(deferred<AgentInvokeResponse>().promise);
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        expect(() => LoopGateway.archiveProject('p-busy')).toThrow('Project p-busy has a run going.');
        expect(mocks.archiveProject).not.toHaveBeenCalled();
        expect(mocks.forgetProject).not.toHaveBeenCalled();
    });

    /**
     * Nothing is let go of until the project has been put away, so a project that stays is a project
     * with everything it was being talked in still held. What a chat thrown away too early costs is
     * only the reading of it back off the disk, which is why the order is worth stating rather than
     * worth guarding.
     */
    test('holds on to the chats and loops of a project it failed to put away', async () => {
        const {loopInfo, loopId} = nextLoop('project', 'p-kept');
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(loopId)).toBe(false));
        const built = mocks.getLoop.mock.calls.length;
        mocks.archiveProject.mockImplementationOnce(() => {
            throw new Error('the archive folder is read only');
        });

        expect(() => LoopGateway.archiveProject('p-kept')).toThrow('the archive folder is read only');

        expect(mocks.forgetProject).not.toHaveBeenCalled();
        expect(events.filter(event => event.eventType === 'updateProject')).toEqual([]);
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        expect(mocks.getLoop.mock.calls.length).toBe(built);
    });

    /** A loop that has been used and is sitting idle is nothing to hold the project back. */
    test('puts away a project whose loop is no longer running', async () => {
        const {loopInfo, loopId} = nextLoop('project', 'p-idle');
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(loopId)).toBe(false));
        LoopGateway.archiveProject('p-idle');
        expect(mocks.archiveProject).toHaveBeenCalledWith('p-idle');
    });

    /**
     * The folder is named even where this write has nothing to do with it: a browser folds a whole
     * project into the one it holds, and a field left out of the fold is a field nothing was said
     * about rather than one that is gone.
     */
    test('announces the refreshed task list of a project', () => {
        const tasks = {t1: {id: 't1', title: 'task', status: 'done'}};
        mocks.getProjectDetail.mockReturnValue({id: 'p1', tasks});
        LoopGateway.updateProjectTask('p1', {id: 't1', status: 'done'});
        expect(mocks.updateTask).toHaveBeenCalledWith('p1', {id: 't1', status: 'done'});
        expect(events).toContainEqual({
            eventType: 'updateProject', content: {id: 'p1', tasks, taskCount: 1, workingDir: null},
        });
    });

    /**
     * A row holds the count and none of the tasks, so tasks arriving without it would leave the
     * count saying what it said before the edit.
     */
    test('announces how many tasks there are along with them', () => {
        mocks.getProjectDetail.mockReturnValue({id: 'p1', tasks: {
            t1: {id: 't1'}, t2: {id: 't2'}, t3: {id: 't3'},
        }});
        LoopGateway.updateProjectTask('p1', {id: 't1', title: 'renamed'});
        expect(events.at(-1)).toEqual(expect.objectContaining({
            content: expect.objectContaining({taskCount: 3}),
        }));
    });

    test('hands a task to an agent that works here', () => {
        mocks.getProjectDetail.mockReturnValue({id: 'p1', tasks: {}});
        LoopGateway.updateProjectTask('p1', {id: 't1', assignee: 'a2'});
        expect(mocks.updateTask).toHaveBeenCalledWith('p1', {id: 't1', assignee: 'a2'});
    });

    /** An id off a request reaches this, and a task nobody works under is never worked on. */
    test('refuses a task handed to an agent that does not work here', () => {
        mocks.getAgent.mockReturnValue(undefined);
        expect(() => LoopGateway.updateProjectTask('p1', {id: 't1', assignee: 'ghost'}))
            .toThrow('No agent "ghost" works here.');
        expect(mocks.updateTask).not.toHaveBeenCalled();
    });

    test('refuses a task handed to an agent that was fired', () => {
        mocks.getAgent.mockReturnValue({id: 'a2', fired: true});
        expect(() => LoopGateway.updateProjectTask('p1', {id: 't1', assignee: 'a2'}))
            .toThrow('No agent "a2" works here.');
        expect(mocks.updateTask).not.toHaveBeenCalled();
    });

    /**
     * Worse than a task nobody works: no run can be built for a name like this, so the gate it
     * stands in front of done is one only the user's own hand gets the task past.
     */
    test('refuses a task left to be read over by nobody who works here', () => {
        mocks.getAgent.mockReturnValue(undefined);
        expect(() => LoopGateway.updateProjectTask('p1', {id: 't1', reviewer: 'ghost'}))
            .toThrow('No agent "ghost" works here.');
        expect(mocks.updateTask).not.toHaveBeenCalled();
    });

    test('takes a reviewer who works here', () => {
        mocks.getAgent.mockReturnValue({id: 'a3', fired: false});
        LoopGateway.updateProjectTask('p1', {id: 't1', reviewer: 'a3'});
        expect(mocks.updateTask).toHaveBeenCalledWith('p1', {id: 't1', reviewer: 'a3'});
    });

    /**
     * A page open for a while shows a task the run has since taken up, and the button on it is a
     * button the browser never heard was gone.
     */
    test('refuses to move the status of a task a subagent is on', () => {
        mocks.isRunning.mockReturnValue(true);
        expect(() => LoopGateway.updateProjectTask('p1', {id: 't1', status: 'ongoing'}))
            .toThrow('This task is being worked on right now.');
        expect(mocks.updateTask).not.toHaveBeenCalled();
        expect(mocks.isRunning).toHaveBeenCalledWith('p1', 't1');
    });

    /**
     * A reading is not work, and nothing the user does to a task under one is a collision. The
     * verdict was advice on a task they are closing by hand anyway. Which the question itself
     * answers, a reading being no run it counts, so there is nothing for this door to leave out.
     */
    test('lets the user move a task that is only being read over', () => {
        mocks.isRunning.mockReturnValue(false);
        LoopGateway.updateProjectTask('p1', {id: 't1', status: 'done'});
        expect(mocks.updateTask).toHaveBeenCalledWith('p1', {id: 't1', status: 'done'});
    });

    /** One write: the task leaving todo is what dates the project as started. */
    test('takes a task up by hand', () => {
        mocks.getProjectDetail.mockReturnValue({id: 'p1', tasks: {t1: {id: 't1'}}});
        LoopGateway.takeUpProjectTask('p1', 't1');
        expect(mocks.updateTask).toHaveBeenCalledWith('p1', {id: 't1', status: 'ongoing'});
        expect(mocks.startProject).not.toHaveBeenCalled();
        expect(events.at(-1)).toEqual(expect.objectContaining({
            content: expect.objectContaining({id: 'p1'}),
        }));
    });

    test('takes up nothing for a task that is not there', () => {
        mocks.getTask.mockReturnValue(undefined);
        expect(() => LoopGateway.takeUpProjectTask('p1', 't1')).toThrow('Task not found.');
        expect(mocks.updateTask).not.toHaveBeenCalled();
    });

    test('takes up nothing for a task that is past being taken up', () => {
        mocks.getTask.mockReturnValue({id: 't1', status: 'done'});
        expect(() => LoopGateway.takeUpProjectTask('p1', 't1'))
            .toThrow('Only a task still in todo can be taken up.');
        expect(mocks.updateTask).not.toHaveBeenCalled();
    });

    /** Whoever is on a task is on it under the status it has, and todo is nobody's. */
    test('refuses to take up a task that is already being worked', () => {
        mocks.getTask.mockReturnValue({id: 't1', status: 'ongoing'});
        expect(() => LoopGateway.takeUpProjectTask('p1', 't1'))
            .toThrow('Only a task still in todo can be taken up.');
    });

    /**
     * The claim on a task goes in before its status does, so in between the record still says todo
     * while the work is already out. The status alone would let this click through on a task a
     * subagent has, and the user would hear they took up work that was never theirs.
     */
    test('refuses to take up a task a subagent was claimed for', () => {
        mocks.isRunning.mockReturnValue(true);
        expect(() => LoopGateway.takeUpProjectTask('p1', 't1'))
            .toThrow('This task is being worked on right now.');
        expect(mocks.updateTask).not.toHaveBeenCalled();
    });

    /** Read by whoever picks the work up, so putting it right while the work runs is the point. */
    test('takes a rename of a task a subagent is on', () => {
        mocks.isRunning.mockReturnValue(true);
        mocks.getProjectDetail.mockReturnValue({id: 'p1', tasks: {}});
        LoopGateway.updateProjectTask('p1', {id: 't1', title: 'renamed'});
        expect(mocks.updateTask).toHaveBeenCalledWith('p1', {id: 't1', title: 'renamed'});
    });

    test('closes a task and announces the project it belongs to', () => {
        const tasks = {t1: {id: 't1', title: 'task', status: 'done'}};
        mocks.getProjectDetail.mockReturnValue({id: 'p1', tasks});
        LoopGateway.finishProjectTask('p1', 't1');
        expect(mocks.finishTask).toHaveBeenCalledWith('p1', 't1');
        expect(events).toContainEqual({
            eventType: 'updateProject', content: {id: 'p1', tasks, taskCount: 1, workingDir: null},
        });
    });

    test('refuses to close a task a subagent is on', () => {
        mocks.isRunning.mockReturnValue(true);
        expect(() => LoopGateway.finishProjectTask('p1', 't1'))
            .toThrow('This task is being worked on right now.');
        expect(mocks.finishTask).not.toHaveBeenCalled();
    });

    test('writes a task report the user put right and announces the project', () => {
        const tasks = {t1: {id: 't1', title: 'task', output: {type: 'markdown', content: 'better'}}};
        mocks.getProjectDetail.mockReturnValue({id: 'p1', tasks});
        expect(LoopGateway.editTaskReport('p1', 't1', 'better')).toBeUndefined();
        expect(mocks.editTaskReport).toHaveBeenCalledWith('p1', 't1', 'better');
        expect(events).toContainEqual({
            eventType: 'updateProject', content: {id: 'p1', tasks, taskCount: 1, workingDir: null},
        });
    });

    /**
     * The run comes back with a report of its own and writes it over whatever the user wrote. Said
     * rather than thrown: the words of a throw do not survive the trip to the browser, and this is
     * a reason worth arriving -- the work comes back and the report is theirs to write then.
     */
    test('turns away a report edited on a task a subagent is on, and says why', () => {
        mocks.isRunning.mockReturnValue(true);
        expect(LoopGateway.editTaskReport('p1', 't1', 'better')).toBe('working');
        expect(mocks.editTaskReport).not.toHaveBeenCalled();
        expect(events.filter(event => event.eventType === 'updateProject')).toEqual([]);
        expect(mocks.isRunning).toHaveBeenCalledWith('p1', 't1');
    });

    test('writes a project report the user put right and announces the project', () => {
        mocks.getProjectDetail.mockReturnValue({id: 'p1', tasks: {}});
        LoopGateway.editProjectReport('p1', '# better');
        expect(mocks.editProjectReport).toHaveBeenCalledWith('p1', '# better');
        expect(events.at(-1)).toEqual(expect.objectContaining({
            eventType: 'updateProject', content: expect.objectContaining({id: 'p1'}),
        }));
    });

    test('collects agents and every project, open and closed', () => {
        mocks.getAgents.mockReturnValue([{id: 'a1', name: 'Ada'}]);
        mocks.getProjectList.mockReturnValue({projects: {open: [{id: 'p1'}], closed: [{id: 'p2'}]}});
        mocks.getProjectDetail.mockImplementation(
            (id: string) => ({id, title: `title of ${id}`, tasks: {}})
        );
        const info = LoopGateway.getDataInfo();
        expect(info.agents).toEqual([{id: 'a1', name: 'Ada', mood: 'none', emotions: []}]);
        expect(info.projects.map(project => project.id)).toEqual(['p1', 'p2']);
    });

    /**
     * The tasks are almost all of a project by weight and the one part of this list that grows
     * with how many projects there are, so what a page starts with holds the count and no more.
     */
    test('hands over every project without any of their tasks', () => {
        mocks.getProjectList.mockReturnValue({projects: {open: [{id: 'p1'}], closed: []}});
        mocks.getProjectDetail.mockReturnValue({
            id: 'p1', title: 'Ship it', tasks: {t1: {id: 't1'}, t2: {id: 't2'}},
        });
        expect(LoopGateway.getDataInfo().projects).toEqual([
            {id: 'p1', title: 'Ship it', taskCount: 2},
        ]);
    });

    /** The whole of one, for the row that opened and has to draw the tasks themselves. */
    test('hands over the tasks of a single project when asked for it', () => {
        const tasks = {t1: {id: 't1'}, t2: {id: 't2'}};
        mocks.getProjectDetail.mockReturnValue({id: 'p1', title: 'Ship it', tasks});
        expect(LoopGateway.getProjectDetail('p1')).toEqual({
            id: 'p1', title: 'Ship it', tasks, taskCount: 2,
        });
    });

    /** Moods live in memory only, so a tab that connects later has to be told how everyone feels. */
    test('collects the mood and the emotions each agent holds right now', () => {
        mocks.getAgents.mockReturnValue([{id: 'a1', name: 'Ada'}]);
        mocks.getProjectList.mockReturnValue({projects: {open: [], closed: []}});
        mocks.getAgentRuntimeStatus.mockReturnValue({mood: 'tired', emotions: ['a long day']});
        expect(LoopGateway.getDataInfo().agents)
            .toEqual([{id: 'a1', name: 'Ada', mood: 'tired', emotions: ['a long day']}]);
        expect(mocks.getAgentRuntimeStatus).toHaveBeenCalledWith('a1');
    });

    /** A page that just loaded has seen no event yet, so the running tasks travel with it. */
    test('collects the tasks subagents are running right now', () => {
        mocks.getProjectList.mockReturnValue({projects: {open: [], closed: []}});
        mocks.getRunningTasks.mockReturnValue([{projectId: 'p1', taskId: 'ship-it', agentId: 'a1'}]);
        expect(LoopGateway.getDataInfo().runningTasks)
            .toEqual([{projectId: 'p1', taskId: 'ship-it', agentId: 'a1'}]);
    });

    test('collects the scheduled tasks as they stand', () => {
        mocks.getProjectList.mockReturnValue({projects: {open: [], closed: []}});
        mocks.getCronTasks.mockReturnValue([{id: 'c1', title: 'daily report'}]);
        expect(LoopGateway.getDataInfo().cronTasks).toEqual([{id: 'c1', title: 'daily report'}]);
    });

    test('collects the loops that are working right now', () => {
        const {loopInfo, loopId, loop} = nextLoop();
        mocks.getProjectList.mockReturnValue({projects: {open: [], closed: []}});
        loop.invoke.mockReturnValue(deferred<AgentInvokeResponse>().promise);
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        expect(LoopGateway.getDataInfo().busyLoops).toContain(loopId);
    });
});

describe('delegations', () => {

    test('reads the skills from the skills manager', () => {
        mocks.getSkillList.mockReturnValue([{name: 'search'}]);
        expect(LoopGateway.getSkills()).toEqual([{name: 'search'}]);
    });

    test('assigns a skill to the given agents', () => {
        LoopGateway.setSkillAgents('search', ['a1']);
        expect(mocks.updateSkillAgents).toHaveBeenCalledWith('search', ['a1']);
    });

    test('tells the caller whether the skills manager found a skill to remove', () => {
        mocks.removeSkill.mockReturnValue(false);
        expect(LoopGateway.removeSkill('search')).toBe(false);
        expect(mocks.removeSkill).toHaveBeenCalledWith('search');
    });

    test('passes the history cursor and page size to the cron service', () => {
        mocks.getCronHistories.mockReturnValue([]);
        LoopGateway.getCronHistories('c1', 1234, 10);
        expect(mocks.getCronHistories).toHaveBeenCalledWith('c1', 1234, 10);
    });

    test('pauses and closes a cron task through the cron service', () => {
        LoopGateway.updateCronTaskStatus('c1', true, false);
        expect(mocks.updateCronTaskStatus).toHaveBeenCalledWith({id: 'c1', pause: true, close: false});
    });

    test('edits a cron task through the cron service', () => {
        LoopGateway.updateCronTask('c1', {title: 'weekly', cron: '0 0 * * 0'});
        expect(mocks.updateCronTask).toHaveBeenCalledWith({id: 'c1', title: 'weekly', cron: '0 0 * * 0'});
    });

    /**
     * The report a run wrote is the largest thing a record carries and nothing in the web app shows
     * it, so it does not go over the wire. Every way a record reaches a browser has to leave it out,
     * or the one that forgot to would carry it all by itself.
     */
    describe('the report a run wrote', () => {

        const history = {
            start: 1000, completed: 2000, status: 'success' as const, finalText: 'the whole report',
            usage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
        };

        test('is not in a listed task', () => {
            mocks.getCronTasks.mockReturnValue([{id: 'c1', title: 'nightly', histories: [history]}]);
            const [task] = LoopGateway.getCronTasks();
            expect(task!.histories[0]).not.toHaveProperty('finalText');
            expect(task!.histories[0]).toMatchObject({start: 1000, status: 'success'});
        });

        test('is not in a page of histories', () => {
            mocks.getCronHistories.mockReturnValue([history]);
            expect(LoopGateway.getCronHistories('c1', 1234, 10)[0]).not.toHaveProperty('finalText');
        });

        test('is not in the update pushed when a run starts or ends', () => {
            LoopGateway.initGateway();
            cron.subscriber!({id: 'c1', histories: [history]});
            const pushed = events.find(event => event.eventType === 'updateCron') as {
                content: {histories: unknown[]}
            };
            expect(pushed.content.histories[0]).not.toHaveProperty('finalText');
            expect(pushed.content.histories[0]).toMatchObject({start: 1000, status: 'success'});
        });

        test('leaves an update carrying no histories alone', () => {
            LoopGateway.initGateway();
            cron.subscriber!({id: 'c1', nextRun: 'tomorrow'});
            expect(events).toContainEqual(
                {eventType: 'updateCron', content: {id: 'c1', nextRun: 'tomorrow'}}
            );
        });
    });

    test('reads the token usage of a loop from the session service', () => {
        const usage = {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3};
        mocks.getTokenUsage.mockReturnValue(usage);
        expect(LoopGateway.getTokenUsage('agent.a1')).toEqual(usage);
    });
});
