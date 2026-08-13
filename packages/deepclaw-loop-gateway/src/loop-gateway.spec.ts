import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {
    BREAK_POINTS,
    type AgentHandler, type AgentInvokeResponse, type AgentRuntime, type CronTask
} from '@deepclaw/core';
import {type AgentConfig, type DeepclawConfig} from '@deepclaw/config';
import {LoopGateway} from './loop-gateway';
import {isLoopStreamEvent, type LoopGatewayEvent, type LoopInfo} from './loop-gateway-types';

const mocks = vi.hoisted(() => ({
    getLoop: vi.fn<(role: string, agentId: string, projectId: string, handler: AgentHandler) => unknown>(
        () => undefined
    ),
    cronSubscribe: vi.fn<(cb: (task: CronTask) => void) => () => void>(() => () => undefined),
    mcpConnect: vi.fn(),
    getTokenUsage: vi.fn(),
    newAgentIdentity: vi.fn(),
    updateAgentIdentity: vi.fn(),
    getAgents: vi.fn(),
    updateProject: vi.fn(),
    updateTask: vi.fn(),
    getProjectDetail: vi.fn(),
    getProjectList: vi.fn(),
    getSkillList: vi.fn(),
    updateSkillAgents: vi.fn(),
    getRunningTasks: vi.fn<() => unknown[]>(() => []),
    getCronTasks: vi.fn(),
    getCronHistories: vi.fn(),
    updateCronTaskStatus: vi.fn(),
    addMessage: vi.fn(),
    replaceMessage: vi.fn(),
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
    },
    MCPService: {connect: mocks.mcpConnect},
    SessionService: {getTokenUsage: mocks.getTokenUsage},
    AgentIdentityManager: {
        newAgentIdentity: mocks.newAgentIdentity,
        updateAgentIdentity: mocks.updateAgentIdentity,
        getAgents: mocks.getAgents,
    },
    ProjectManager: {
        updateProject: mocks.updateProject,
        updateTask: mocks.updateTask,
        getProjectDetail: mocks.getProjectDetail,
        getProjectList: mocks.getProjectList,
    },
    SkillsManager: {getSkillList: mocks.getSkillList, updateSkillAgents: mocks.updateSkillAgents},
    RunningTaskService: {getRunningTasks: mocks.getRunningTasks},
}));

vi.mock('./ui-chat-service', () => ({
    UIChatService: {addMessage: mocks.addMessage, replaceMessage: mocks.replaceMessage},
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
        breakPoint: {point: BREAK_POINTS.none},
        recoveryState: {maxTokenRetries: 0, refusalState: ''},
        usage: {cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0},
        ...overrides,
    };
}

function newFakeLoop() {
    return {
        isOutdated: vi.fn(() => false),
        invoke: vi.fn(async (): Promise<AgentInvokeResponse> => ({text: 'reply', runtime: newRuntime()})),
        resume: vi.fn(async (): Promise<AgentInvokeResponse> => ({text: 'resumed', runtime: newRuntime()})),
        updateAgentConfig: vi.fn(),
        setExternalInterruptReason: vi.fn(),
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

function busyEvents(list: LoopGatewayEvent[]): LoopGatewayEvent[] {
    return list.filter(event => event.eventType === 'busy');
}

function capturedHandler(): AgentHandler {
    return mocks.getLoop.mock.calls.at(-1)![3];
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLoop.mockImplementation(() => currentLoop);
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
        expect(mocks.getLoop).toHaveBeenCalledWith('project', loopInfo.agentId, 'p1', expect.anything());
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
        invoked.resolve({text: 'done', runtime: newRuntime()});
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
        invoked.resolve({text: 'final answer', runtime: newRuntime()});
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(loopId)).toBe(false));
        expect(mocks.replaceMessage).toHaveBeenCalledWith(loopId, msgId, 'final answer');
        expect(onDone).toHaveBeenCalledWith('final answer');
        expect(busyEvents(events).at(-1)).toEqual({eventType: 'busy', loopId, busy: false});
    });

    test('marks an answer that came through im', async () => {
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockResolvedValue({text: 'final answer', runtime: newRuntime()});
        const {msgId} = LoopGateway.invoke(loopInfo, {source: 'im'}, 'hi');
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(loopId)).toBe(false));
        expect(mocks.replaceMessage).toHaveBeenCalledWith(loopId, msgId, '📱 final answer');
    });

    test('publishes the token usage of the session when there is one', async () => {
        const usage = {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3};
        mocks.getTokenUsage.mockReturnValue(usage);
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockResolvedValue({text: 'done', runtime: newRuntime()});
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
        loop.invoke.mockResolvedValue({text: 'done', runtime: newRuntime()});
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'first');
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(loopId)).toBe(false));
        loop.isOutdated.mockReturnValue(true);
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'second');
        expect(mocks.getLoop).toHaveBeenCalledTimes(2);
    });
});

describe('resume', () => {

    test('refuses to resume an unknown loop', () => {
        expect(LoopGateway.resume('b1', 'web', 'agent.never-seen')).toEqual({resume: false, msgId: ''});
    });

    test('refuses to resume a loop that has no pending runtime', () => {
        const {loopId} = nextLoop();
        LoopGateway.initLoop(loopId);
        expect(LoopGateway.resume('b1', 'web', loopId).resume).toBe(false);
    });

    test('keeps the runtime for a resume while the agent waits for a human', async () => {
        const {loopInfo, loopId, loop} = nextLoop();
        const runtime = newRuntime({agentBreakReason: 'interactionAfk', turnCount: 4});
        loop.invoke.mockResolvedValue({text: 'waiting', runtime});
        const {msgId} = LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        await vi.waitFor(() => expect(LoopGateway.resume('b1', 'web', loopId)).toEqual({resume: true, msgId}));
        expect(loop.resume).toHaveBeenCalledWith(expect.objectContaining({
            browserId: 'b1', runtime: expect.objectContaining({turnCount: 4})
        }));
        expect(mocks.replaceMessage).not.toHaveBeenCalledWith(loopId, msgId, 'waiting');
    });

    /** An agent board reads that list, and an agent that waits for an answer is not at work. */
    test('leaves a loop that waits for a human out of the working ones', async () => {
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockResolvedValue({
            text: 'waiting', runtime: newRuntime({agentBreakReason: 'interactionAfk'})
        });
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        await vi.waitFor(() => expect(LoopGateway.getBusyLoops()).not.toContain(loopId));
        expect(LoopGateway.isLoopBusy(loopId)).toBe(true);
        expect(events.at(-1)).toEqual({
            eventType: 'updateBusyLoops', content: expect.not.arrayContaining([loopId])
        });
    });

    test('ignores a resume asked by another browser', async () => {
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockResolvedValue({
            text: 'waiting', runtime: newRuntime({agentBreakReason: 'interactionAfk'})
        });
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        await vi.waitFor(() => expect(LoopGateway.isLoopBusy(loopId)).toBe(true));
        expect(LoopGateway.resume('other-browser', 'web', loopId).resume).toBe(false);
        expect(loop.resume).not.toHaveBeenCalled();
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

    test('keeps the questions of two browsers apart', async () => {
        const {loopId} = nextLoop();
        const first = askQuestion(loopId, 'b1');
        const second = askQuestion(loopId, 'b2');
        LoopGateway.resolveInteraction('b2', loopId, 'from b2');
        LoopGateway.resolveInteraction('b1', loopId, 'from b1');
        await expect(first).resolves.toBe('from b1');
        await expect(second).resolves.toBe('from b2');
    });

    test('rejects a cancelled question with its reason', async () => {
        const {loopId} = nextLoop();
        const answer = askQuestion(loopId);
        LoopGateway.cancelInteraction('b1', loopId, 'disconnected');
        await expect(answer).rejects.toBe('disconnected');
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
});

describe('disconnectBrowser', () => {

    test('interrupts the loop that the browser was driving', async () => {
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockReturnValue(deferred<AgentInvokeResponse>().promise);
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        LoopGateway.disconnectBrowser('b1');
        expect(loop.setExternalInterruptReason).toHaveBeenCalledWith('clientLost');
        expect(LoopGateway.isLoopBusy(loopId)).toBe(true);
    });

    test('leaves the loops of other browsers alone', () => {
        const {loopInfo, loop} = nextLoop();
        loop.invoke.mockReturnValue(deferred<AgentInvokeResponse>().promise);
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        LoopGateway.disconnectBrowser('b2');
        expect(loop.setExternalInterruptReason).not.toHaveBeenCalled();
    });

    test('cancels the question the lost browser was asked', async () => {
        const {loopInfo, loopId, loop} = nextLoop();
        loop.invoke.mockReturnValue(deferred<AgentInvokeResponse>().promise);
        LoopGateway.invoke(loopInfo, {source: 'web', browserId: 'b1'}, 'hi');
        const answer = capturedHandler().onInteractionEvent({
            eventType: 'interaction', loopId, browserId: 'b1', type: 'input', content: 'your name?'
        });
        LoopGateway.disconnectBrowser('b1');
        await expect(answer).rejects.toBe('disconnected');
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

    test('announces the refreshed task list of a project', () => {
        const tasks = {t1: {title: 'task', status: 'done'}};
        mocks.getProjectDetail.mockReturnValue({id: 'p1', tasks});
        LoopGateway.updateProjectTask('p1', {title: 'task', status: 'done'});
        expect(mocks.updateTask).toHaveBeenCalledWith('p1', {title: 'task', status: 'done'});
        expect(events).toContainEqual({eventType: 'updateProject', content: {id: 'p1', tasks}});
    });

    test('collects agents and full project details', () => {
        mocks.getAgents.mockReturnValue([{id: 'a1', name: 'Ada'}]);
        mocks.getProjectList.mockReturnValue({projects: {open: [{id: 'p1'}], closed: [{id: 'p2'}]}});
        mocks.getProjectDetail.mockImplementation((id: string) => ({id, title: `title of ${id}`}));
        const info = LoopGateway.getDataInfo();
        expect(info.agents).toEqual([{id: 'a1', name: 'Ada', mood: 'none'}]);
        expect(info.projects.map(project => project.id)).toEqual(['p1', 'p2']);
    });

    /** A page that just loaded has seen no event yet, so the running tasks travel with it. */
    test('collects the tasks subagents are running right now', () => {
        mocks.getProjectList.mockReturnValue({projects: {open: [], closed: []}});
        mocks.getRunningTasks.mockReturnValue([{projectId: 'p1', taskTitle: 'ship it', agentId: 'a1'}]);
        expect(LoopGateway.getDataInfo().runningTasks)
            .toEqual([{projectId: 'p1', taskTitle: 'ship it', agentId: 'a1'}]);
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

    test('passes the history cursor and page size to the cron service', () => {
        mocks.getCronHistories.mockReturnValue([]);
        LoopGateway.getCronHistories('c1', 1234, 10);
        expect(mocks.getCronHistories).toHaveBeenCalledWith('c1', 1234, 10);
    });

    test('pauses and closes a cron task through the cron service', () => {
        LoopGateway.updateCronTaskStatus('c1', true, false);
        expect(mocks.updateCronTaskStatus).toHaveBeenCalledWith({id: 'c1', pause: true, close: false});
    });

    test('reads the token usage of a loop from the session service', () => {
        const usage = {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3};
        mocks.getTokenUsage.mockReturnValue(usage);
        expect(LoopGateway.getTokenUsage('agent.a1')).toEqual(usage);
    });
});
