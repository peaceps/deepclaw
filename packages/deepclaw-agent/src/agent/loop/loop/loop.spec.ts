import {beforeEach, describe, expect, test, vi} from 'vitest';
import {
    type AgentHandler, type AgentInvokeOptions, type AgentInvokeResponse, type AgentRuntime,
    type ImageContent, type FlushAgentRole, type LLMTransitionReason, type SealedAgentHandler,
    type TokenUsage
} from '@deepclaw/core';
import {type AgentConfig, type AgentMode} from '@deepclaw/config';
import {type Logger} from '@deepclaw/node-utils';
import {
    type AssignedTask, type CarriedLoopState, type LLMProtocol, type LoopKind, type OneLoopContext,
    type OverflowLimit, type SpawnedLoop, type SystemPrompt,
} from '../../definitions/definitions';
import {type ToolUseDef, type ToolUseResult} from '../../definitions/tool-definitions';
import {type LLMConstructor, type LLMModel} from '../../llm/llmgw';
import {newTestAgentConfig} from '../../../test-support/one-loop-context';
import {LoopAgent} from './loop';

const mocks = vi.hoisted(() => ({
    loadAgentConfig: vi.fn<(agentId: string) => unknown>(),
    getSessionDir: vi.fn<(...args: unknown[]) => string>(() => '.agents/a1/session/s1'),
    loadSession: vi.fn<(...args: unknown[]) => unknown>(() => ({history: [], outdated: false})),
    updateSessionRuntime: vi.fn(),
    saveHistory: vi.fn(),
    nameSession: vi.fn<(context: unknown, input: string) => void>(),
    markHistoryProtocol: vi.fn(),
    provideSystemPrompt: vi.fn<(...args: unknown[]) => unknown>(
        () => ({cacheable: 'cacheable', dynamic: 'dynamic'})
    ),
    taskAssignee: vi.fn<(...args: unknown[]) => unknown>(() => undefined),
    taskAssigneeId: vi.fn<(...args: unknown[]) => string | undefined>(() => undefined),
    getAgent: vi.fn<(agentId: string) => unknown>(() => ({id: 'a1', name: 'Ada'})),
    emitVisitor: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
    emitInterceptor: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({result: 'continue'})),
    executeToolCall: vi.fn<(toolUseDef: ToolUseDef, context: unknown) => Promise<unknown>>(),
    planExecutionGroups: vi.fn<(toolUseDefs: ToolUseDef[], context: unknown) => ToolUseDef[][]>(),
    clearAwayUser: vi.fn<(loopId: string) => void>(),
    compactOldResults: vi.fn(),
    compactFullHistory: vi.fn<(force: boolean, ...rest: unknown[]) => Promise<boolean>>(
        async () => true
    ),
    budgetOf: vi.fn<(...args: unknown[]) => {tokens: number; bytes: number}>(
        () => ({tokens: 150000, bytes: 4 * 1024 * 1024})
    ),
    observeAccepted: vi.fn<(...args: unknown[]) => void>(),
    observeRefused: vi.fn<(...args: unknown[]) => void>(),
    aTurnPassed: vi.fn<(agentId: string) => void>(),
    getSpawnedLoop: vi.fn<(...args: unknown[]) => unknown>(),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    getLoopLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

vi.mock('@deepclaw/i18n', () => ({
    i18nInstance: {
        t: (key: string, params?: Record<string, unknown>) =>
            params ? `${key}:${JSON.stringify(params)}` : key,
    },
}));

vi.mock('@deepclaw/config', () => ({loadAgentConfig: mocks.loadAgentConfig}));

vi.mock('../services/session-service', () => ({
    SessionService: {
        getSessionDir: mocks.getSessionDir,
        loadSession: mocks.loadSession,
        updateSessionRuntime: mocks.updateSessionRuntime,
        saveHistory: mocks.saveHistory,
        nameSession: mocks.nameSession,
        markHistoryProtocol: mocks.markHistoryProtocol,
    },
}));

vi.mock('../services/prompt-service', () => ({
    PromptService: {
        provideSystemPrompt: mocks.provideSystemPrompt,
        taskAssignee: mocks.taskAssignee,
        taskAssigneeId: mocks.taskAssigneeId,
    },
}));

vi.mock('../services/agent-identity-manager', () => ({
    AgentIdentityManager: {getAgent: mocks.getAgent},
}));

vi.mock('../services/agent-feeling-service', () => ({
    AgentFeelingService: {aTurnPassed: mocks.aTurnPassed},
}));

/**
 * A task worked by somebody else's model is built through the initializer, which is the only thing
 * that knows the class of a loop of another vendor. Stood in for here by one that builds the loop
 * of this file, so that a run handed over is still a run these tests can drive.
 */
vi.mock('../../loop-initializer', () => ({
    LoopInitializer: {getSpawnedLoop: mocks.getSpawnedLoop},
}));

vi.mock('../services/llm-window-service', () => ({
    LLMWindowService: {
        budgetOf: mocks.budgetOf,
        observeAccepted: mocks.observeAccepted,
        observeRefused: mocks.observeRefused,
    },
}));

vi.mock('../services/hook-manager', () => ({
    HookManager: {emitVisitor: mocks.emitVisitor, emitInterceptor: mocks.emitInterceptor},
}));

vi.mock('../services/tool-use-service', () => ({
    ToolUseService: {
        executeToolCall: mocks.executeToolCall,
        planExecutionGroups: mocks.planExecutionGroups,
        clearAwayUser: mocks.clearAwayUser,
    },
}));

vi.mock('../compactor/messages-compactor', () => ({
    MessageCompactor: {
        getCompactor: () => ({
            compactOldResults: mocks.compactOldResults,
            compactFullHistory: mocks.compactFullHistory,
        }),
    },
}));

/**
 * The fake protocol models which calls a message asks for and which one a result answers, though
 * nothing in the loop reads either. They are what expectValidHistory needs to see: the pairing is
 * an invariant of every history we hand over, and one a stop is very well placed to break.
 */
type TestMessage = {
    role: 'user' | 'assistant' | 'tool',
    text: string,
    toolUseIds?: string[],
    toolResultId?: string,
};
type TestResponse = {
    transitionReason: LLMTransitionReason;
    text?: string;
    toolUses?: ToolUseDef[];
    /** The limit this refusal named, left where the real one leaves it for the loop to take. */
    observedLimit?: OverflowLimit;
};

class FakeLLM {
    public static instances: FakeLLM[] = [];
    public readonly loopKind: LoopKind;
    public readonly role: FlushAgentRole;
    public readonly llmConfig: unknown;
    public responses: TestResponse[] = [];
    public usage: TokenUsage = {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3};
    public updateGWConfig = vi.fn();

    public invoke = vi.fn<(
        mode: AgentMode, system: SystemPrompt, messages: TestMessage[],
        onText: (text: string) => void, logger: Logger, signal?: AbortSignal
    ) => Promise<TestResponse>>(async (...args) => {
        const [, , messages, onText] = args;
        const response = this.responses.shift() ?? {transitionReason: 'endLoop' as LLMTransitionReason};
        if (response.observedLimit) {
            this.observedLimit = response.observedLimit;
        }
        // A refusal leaves nothing behind at all: not a word on the stream, and no message in the
        // history either -- the gateway keeps it out so the compaction has the conversation as it
        // stood to work on. A fixture that left one would say every call adds a message, and the
        // code under it could go on believing that.
        if (response.transitionReason === 'inputMaxTokens') {
            return response;
        }
        // Only what there is to say. A turn that goes straight to a tool says nothing, and an
        // empty chunk is a frame the stream never carried.
        if (response.text) {
            onText(response.text);
        }
        messages.push({
            role: 'assistant',
            text: response.text ?? '',
            ...(response.toolUses?.length ? {toolUseIds: response.toolUses.map(def => def.id)} : {}),
        });
        return response;
    });

    constructor(loopKind: LoopKind, role: FlushAgentRole, llmConfig: unknown) {
        this.loopKind = loopKind;
        this.role = role;
        this.llmConfig = llmConfig;
        FakeLLM.instances.push(this);
    }

    public getTokenUsage(): TokenUsage {
        return this.usage;
    }

    public observedLimit: OverflowLimit | undefined;

    public takeObservedLimit(): OverflowLimit | undefined {
        const limit = this.observedLimit;
        this.observedLimit = undefined;
        return limit;
    }

    public modelName(): string {
        return 'test-model';
    }

    public newInputMessage(text: string, user: boolean): TestMessage {
        return {role: user ? 'user' : 'assistant', text};
    }

    public newImageInputMessage(text: string, images: ImageContent[]): TestMessage {
        return {role: 'user', text: `${text} [${images.map(image => image.url).join(',')}]`};
    }

    public getTextFromInputMessage(message: TestMessage): string {
        return message.text;
    }
}

type TestLLM = LLMModel<TestMessage, TestResponse, unknown, unknown>;

class TestLoop extends LoopAgent<TestMessage, TestResponse, TestLLM> {
    public static spawnedLoops: TestLoop[] = [];

    protected override getLLMProtocol(): LLMProtocol {
        return 'OpenAIChat';
    }

    protected override getLLMConstructor(): LLMConstructor<TestMessage, TestResponse, unknown, unknown> {
        return FakeLLM as unknown as LLMConstructor<TestMessage, TestResponse, unknown, unknown>;
    }

    protected override extractToolUseFromResponse(response: TestResponse): ToolUseDef[] {
        return response.toolUses ?? [];
    }

    protected override convertToolResultMessages(toolResults: ToolUseResult[]): TestMessage[] {
        return toolResults.map(result => ({
            role: 'tool', text: result.content, toolResultId: result.id
        }));
    }

    protected override newLoop(
        role: FlushAgentRole, agentId: string, projectId: string,
        agentHandler: AgentHandler, spawned?: SpawnedLoop
    ): TestLoop {
        const spawnedLoop = new TestLoop(role, agentId, projectId, agentHandler, spawned);
        TestLoop.spawnedLoops.push(spawnedLoop);
        return spawnedLoop;
    }

    public fakeLLM(): FakeLLM {
        return this.llm as unknown as FakeLLM;
    }

    public sealedHandler(): SealedAgentHandler {
        return this.agentHandler;
    }

    public runInvoke(input: string, options: AgentInvokeOptions): Promise<AgentInvokeResponse> {
        return this._invoke(input, options);
    }

    public newTestSubLoop(): TestLoop {
        return this.createSubLoop() as TestLoop;
    }

    public newTestTaskLoop(
        assignedTask: AssignedTask = {projectId: 'p1', taskId: 'ship-it'}
    ): Promise<TestLoop> {
        return this.createTaskLoop(assignedTask) as Promise<TestLoop>;
    }
}

/**
 * A task the board hands to an agent we know, which is both halves of one fact: the name to work
 * under and the model to work on. They part company only where the agent is gone, which is its own
 * test below.
 */
function assignedTo(id: string, name = 'Bob'): void {
    mocks.taskAssignee.mockReturnValue({id, name});
    mocks.taskAssigneeId.mockReturnValue(id);
}

function newSpawned(kind: 'task' | 'sub', assignedTask?: AssignedTask): SpawnedLoop {
    return {kind, runId: `${kind}1`, assignedTask, permissionWhiteList: new Set()};
}

function newHandler(): AgentHandler {
    return {
        onStreamText: vi.fn(),
        onInteractionEvent: vi.fn(async () => 'answer'),
        onInfoEvent: vi.fn(),
    };
}

function newLoop(options: {
    role?: FlushAgentRole, config?: AgentConfig, history?: TestMessage[], outdated?: boolean,
    handler?: AgentHandler, spawned?: SpawnedLoop, carried?: CarriedLoopState
} = {}) {
    const handler = options.handler ?? newHandler();
    mocks.loadAgentConfig.mockReturnValue(options.config ?? newTestAgentConfig());
    mocks.loadSession.mockReturnValue({history: options.history ?? [], outdated: options.outdated ?? false});
    const loop = new TestLoop(options.role ?? 'agent', 'a1', '', handler, options.spawned, options.carried);
    return {loop, handler, llm: loop.fakeLLM()};
}

function newCarried(overrides: Partial<CarriedLoopState> = {}): CarriedLoopState {
    return {permissionWhiteList: new Set(), footPrints: [], ...overrides};
}

/** The context of the first tool the run called, which is where the loop's own state shows up. */
function contextOfFirstTool(): OneLoopContext {
    return mocks.executeToolCall.mock.calls[0]![1] as OneLoopContext;
}

/** The history array the loop persisted on its last save. */
function savedHistory(): TestMessage[] {
    return mocks.saveHistory.mock.calls.at(-1)![0] as TestMessage[];
}

function toolUse(id: string, name = 'demo'): ToolUseDef {
    return {id, name, input: {}};
}

/**
 * What a history has to be for the next call on it to be accepted, asserted in one place because
 * the several ways a run can be stopped all end in the same three questions.
 *
 * Worth saying why it is decided here rather than by sending the history somewhere. An endpoint
 * speaking a protocol loosely takes a history breaking every line below, so a run that went
 * through says only that this endpoint is not fussy, and the same history is a 400 against a
 * strict one. These hold or they do not, whatever anybody is willing to accept.
 */
function expectValidHistory(messages: TestMessage[]): void {
    // Nothing may follow the user but the agent: a stop that pushes no answer of its own leaves
    // the last word with the user, and the next thing they say lands right behind it.
    expect(messages.at(-1)?.role).toBe('assistant');
    expect(messages.filter(
        (message, index) => message.role === 'user' && messages[index - 1]?.role === 'user'
    )).toEqual([]);
    // A message saying nothing at all is refused, and a stop is where one is easiest to write.
    expect(messages.filter(
        message => message.role === 'assistant' && !message.text && !message.toolUseIds?.length
    )).toEqual([]);
    // Every call asked for is answered, and nothing answers a call that was never asked for.
    const asked = messages.flatMap(message => message.toolUseIds ?? []).sort();
    const answered = messages.flatMap(
        message => message.toolResultId ? [message.toolResultId] : []
    ).sort();
    expect(answered).toEqual(asked);
}

beforeEach(() => {
    vi.clearAllMocks();
    FakeLLM.instances = [];
    TestLoop.spawnedLoops = [];
    mocks.getSessionDir.mockReturnValue('.agents/a1/session/s1');
    mocks.loadSession.mockReturnValue({history: [], outdated: false});
    mocks.provideSystemPrompt.mockReturnValue({cacheable: 'cacheable', dynamic: 'dynamic'});
    mocks.taskAssignee.mockReturnValue(undefined);
    mocks.taskAssigneeId.mockReturnValue(undefined);
    mocks.getAgent.mockReturnValue({id: 'a1', name: 'Ada'});
    mocks.emitVisitor.mockResolvedValue(undefined);
    mocks.emitInterceptor.mockResolvedValue({result: 'continue'});
    mocks.budgetOf.mockReturnValue({tokens: 150000, bytes: 4 * 1024 * 1024});
    mocks.executeToolCall.mockImplementation(async (def) => ({
        result: {id: def.id, content: `${def.name} done`}, success: true
    }));
    mocks.planExecutionGroups.mockImplementation(defs => defs.map(def => [def]));
    mocks.getSpawnedLoop.mockImplementation(
        (role, agentId, projectId, handler, spawned) => new TestLoop(
            role as FlushAgentRole, agentId as string, projectId as string,
            handler as AgentHandler, spawned as SpawnedLoop
        )
    );
});

describe('construction', () => {

    test('builds its llm with the agent llm config and the loop kind', () => {
        const config = newTestAgentConfig({llm: {baseURL: 'https://api.openai.com', apiKey: 'k', model: 'm'}});
        const {llm} = newLoop({config});
        expect(llm.loopKind).toBe('main');
        expect(llm.llmConfig).toEqual({baseURL: 'https://api.openai.com', apiKey: 'k', model: 'm'});
    });

    // 工具集要按运行身份筛，llm 得知道自己跑在哪种身份下
    test('takes the role it runs under over to its llm', () => {
        expect(newLoop({role: 'cron'}).llm.role).toBe('cron');
        expect(newLoop({role: 'agent'}).llm.role).toBe('agent');
    });

    test('takes the kind it was spawned as over to its llm', () => {
        expect(newLoop({spawned: newSpawned('sub')}).llm.loopKind).toBe('sub');
        expect(newLoop({spawned: newSpawned('task')}).llm.loopKind).toBe('task');
    });

    /**
     * The session is picked before the first turn, so a loop that learned what it is any later
     * would already have read the history of the loop that spawned it and would write over it.
     */
    test('knows what it was spawned as before it reads a session', () => {
        newLoop({spawned: newSpawned('task')});
        expect(mocks.loadSession).toHaveBeenCalledWith(expect.objectContaining({loopKind: 'task'}));
    });

    test('forces the agent mode for a cron run', async () => {
        const {loop} = newLoop({role: 'cron', config: newTestAgentConfig({mode: 'chat'})});
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(loop.fakeLLM().invoke.mock.calls[0]![0]).toBe('agent');
    });

    test('keeps the configured mode for a normal run', async () => {
        const {loop} = newLoop({config: newTestAgentConfig({mode: 'chat'})});
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(loop.fakeLLM().invoke.mock.calls[0]![0]).toBe('chat');
    });

    test('starts from the persisted history', async () => {
        const {loop} = newLoop({history: [{role: 'user', text: 'earlier'}]});
        await loop.runInvoke('now', {browserId: 'b1'});
        expect(savedHistory().map(message => message.text)).toEqual(['earlier', 'now', '']);
    });

    test('reports the session as outdated when the stored protocol no longer matches', () => {
        const {loop} = newLoop({outdated: true});
        expect(loop.isOutdated()).toBe(true);
    });

    test('asks the session service for its own folder', () => {
        const spawned = newSpawned('sub');
        const {loop} = newLoop({spawned});
        expect(mocks.getSessionDir).toHaveBeenCalledWith('agent', 'a1', '', spawned);
        expect(loop.getSessionDir()).toBe('.agents/a1/session/s1');
    });
});

/**
 * Standing in for a loop the gateway let go of to reclaim the memory it was holding. The history
 * comes back off the disk by itself; what crosses over here is everything a conversation has that
 * was never written down. It is an argument rather than a lookup because the rebuild after a
 * provider change goes through this very same constructor and is meant to begin with none of it.
 */
describe('taking over from a loop that was dropped', () => {

    test('works with the white list the loop it stands in for was granted', async () => {
        const {loop, llm} = newLoop({
            carried: newCarried({permissionWhiteList: new Set(['file'])})
        });
        llm.responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('tu1')]},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        await loop.runInvoke('read it', {browserId: 'b1'});
        expect([...contextOfFirstTool().permissionWhiteList]).toEqual(['file']);
    });

    test('asks for itself where it stands in for nobody', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('tu1')]},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        await loop.runInvoke('read it', {browserId: 'b1'});
        expect([...contextOfFirstTool().permissionWhiteList]).toEqual([]);
    });

    /**
     * The token count is what the compaction is decided on, and the one thing that measures a
     * history exactly. Without it the first turn of the loop that took over would fall back to
     * counting bytes at a rate that means something different per conversation.
     */
    test('weighs its first turn against the token count it was handed', async () => {
        const {loop, llm} = newLoop({carried: newCarried({lastInputTokens: 2000})});
        mocks.budgetOf.mockReturnValue({tokens: 1000, bytes: 4 * 1024 * 1024});
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.compactFullHistory.mock.calls.map(call => call[0])).toEqual([true]);
    });

    test('has nothing to weigh its first turn against where it stands in for nobody', async () => {
        const {loop, llm} = newLoop();
        mocks.budgetOf.mockReturnValue({tokens: 1000, bytes: 4 * 1024 * 1024});
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.compactFullHistory.mock.calls.map(call => call[0])).toEqual([false]);
    });

    test('goes on naming the pictures drawn before it', () => {
        const {loop} = newLoop({
            carried: newCarried({footPrints: [{type: 'image', content: 'dcimg://agent.a1/a.png'}]})
        });
        expect(loop.getDrawnImages()).toEqual(['dcimg://agent.a1/a.png']);
    });

    test('hands the trace it was given to the compaction of its own first turn', async () => {
        const footPrints = [{type: 'read_file', content: 'notes.md'}];
        const {loop, llm} = newLoop({carried: newCarried({footPrints})});
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.compactFullHistory.mock.calls[0]![2]).toBe(footPrints);
    });

    test('offers everything it was handed on to whoever takes over from it', () => {
        const carried = newCarried({
            permissionWhiteList: new Set(['command']),
            lastInputTokens: 900,
            footPrints: [{type: 'read_file', content: 'notes.md'}],
        });
        expect(newLoop({carried}).loop.carriedState()).toEqual(carried);
    });

    /**
     * The trace of a run outlives every loop that holds it once it is handed on, and a file read
     * twice says nothing the second time: both readers of it work off a set of the contents.
     */
    test('says each thing it read once to whoever takes over from it', () => {
        const {loop} = newLoop({carried: newCarried({footPrints: [
            {type: 'read_file', content: 'notes.md'},
            {type: 'read_file', content: 'notes.md'},
            {type: 'image', content: 'notes.md'},
        ]})});
        expect(loop.carriedState().footPrints).toEqual([
            {type: 'read_file', content: 'notes.md'},
            {type: 'image', content: 'notes.md'},
        ]);
    });

    test('offers what the model counted of its last request rather than what it started with', async () => {
        const {loop, llm} = newLoop({carried: newCarried({lastInputTokens: 900})});
        llm.usage = {cachedInputTokens: 700, noCachedInputTokens: 300, outputTokens: 5};
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(loop.carriedState().lastInputTokens).toBe(1000);
    });
});

describe('updateAgentConfig', () => {

    test('hands a new client to the gateway when the endpoint changes inside the same protocol', () => {
        const {loop, llm} = newLoop();
        loop.updateAgentConfig(newTestAgentConfig({
            llm: {baseURL: 'https://other.openai.com', apiKey: 'k2', model: 'm2'}
        }));
        expect(llm.updateGWConfig).toHaveBeenCalledWith(
            {baseURL: 'https://other.openai.com', apiKey: 'k2'}, {model: 'm2'}
        );
        expect(loop.isOutdated()).toBe(false);
    });

    test('only refreshes the model when the endpoint stayed the same', () => {
        const config = newTestAgentConfig({llm: {baseURL: 'https://api.example.com', apiKey: 'key', model: 'm1'}});
        const {loop, llm} = newLoop({config});
        loop.updateAgentConfig(newTestAgentConfig({
            llm: {baseURL: 'https://api.example.com', apiKey: 'key', model: 'm2'}
        }));
        expect(llm.updateGWConfig).toHaveBeenCalledWith(null, {model: 'm2'});
    });

    test('retires the loop when the protocol of the new endpoint differs', () => {
        const {loop, llm} = newLoop();
        loop.updateAgentConfig(newTestAgentConfig({
            llm: {baseURL: 'https://api.anthropic.com', apiKey: 'key', model: 'm'}
        }));
        expect(loop.isOutdated()).toBe(true);
        expect(llm.updateGWConfig).toHaveBeenCalledWith(null, {model: 'm'});
    });

    /** The url says openai chat either way, so the pick is the only thing that moved. */
    test('retires the loop when a protocol is picked that the url did not say', () => {
        const {loop} = newLoop();
        loop.updateAgentConfig(newTestAgentConfig({
            llm: {
                baseURL: 'https://api.example.com', apiKey: 'key', model: 'model',
                protocol: 'OpenAIResponse',
            }
        }));
        expect(loop.isOutdated()).toBe(true);
    });

    /** Back to auto, where the url names another protocol than the pick that was cleared. */
    test('retires the loop when the picked protocol is cleared', () => {
        const config = newTestAgentConfig({
            llm: {
                baseURL: 'https://api.example.com', apiKey: 'key', model: 'model',
                protocol: 'OpenAIResponse',
            }
        });
        const {loop} = newLoop({config});
        loop.updateAgentConfig(newTestAgentConfig({
            llm: {baseURL: 'https://api.example.com', apiKey: 'key', model: 'model'}
        }));
        expect(loop.isOutdated()).toBe(true);
    });

    test('keeps the loop where the protocol picked is the one it was already built to', () => {
        const {loop, llm} = newLoop();
        loop.updateAgentConfig(newTestAgentConfig({
            llm: {
                baseURL: 'https://api.example.com', apiKey: 'key', model: 'model',
                protocol: 'OpenAIChat',
            }
        }));
        expect(loop.isOutdated()).toBe(false);
        expect(llm.updateGWConfig).toHaveBeenCalledWith(
            {baseURL: 'https://api.example.com', apiKey: 'key'}, {model: 'model'}
        );
    });
});

describe('one turn', () => {

    test('returns the last message as the final text once the llm ends the loop', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{transitionReason: 'endLoop', text: 'all done'}];
        const {text} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(text).toBe('all done');
        expect(llm.invoke).toHaveBeenCalledOnce();
    });

    test('counts the turn and accumulates the token usage', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        const {runtime} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(runtime.turnCount).toBe(1);
        expect(runtime.usage).toEqual({cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3});
    });

    /**
     * Counted here rather than where the prompt shows a feeling back, so that a prompt built for
     * anything but a turn does not age one, and counted once however many prompts a turn builds.
     */
    test('ages what the agent last said it felt by the turn', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('t1')]},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.aTurnPassed.mock.calls).toEqual([['a1'], ['a1']]);
    });

    test('ages nothing of what a scheduled run does, having nothing it could feel', async () => {
        const {loop, llm} = newLoop({role: 'cron'});
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.aTurnPassed).not.toHaveBeenCalled();
    });

    test('ages nothing of what a sub loop does, it speaking for nobody', async () => {
        const {loop, llm} = newLoop({spawned: newSpawned('sub')});
        assignedTo('a2');
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.aTurnPassed).not.toHaveBeenCalled();
    });

    /**
     * The turns of a task are turns of the agent it is worked as: the card they age is the one they
     * would write to, and a feeling of theirs left standing through an afternoon of work done in
     * their name is exactly what going stale means.
     */
    test('ages what the agent a task is worked as last felt', async () => {
        const {loop, llm} = newLoop({spawned: newSpawned('task', {projectId: 'p1', taskId: 'ship-it'})});
        assignedTo('a2');
        llm.responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('t1')]},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.aTurnPassed.mock.calls).toEqual([['a2'], ['a2']]);
    });

    test('ages nothing where the task it works belongs to nobody', async () => {
        const {loop, llm} = newLoop({spawned: newSpawned('task', {projectId: 'p1', taskId: 'ship-it'})});
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.aTurnPassed).not.toHaveBeenCalled();
    });

    test('adds the user input to the history before calling the llm', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('please help', {browserId: 'b1'});
        expect(llm.invoke.mock.calls[0]![2][0]).toEqual({role: 'user', text: 'please help'});
    });

    test('turns the input into an image message when the caller sent images', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('what is this', {browserId: 'b1', images: [{url: 'https://host/a.png'}]});
        expect(llm.invoke.mock.calls[0]![2][0])
            .toEqual({role: 'user', text: 'what is this [https://host/a.png]'});
    });

    test('refreshes the system prompt at the start of the loop', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.provideSystemPrompt).toHaveBeenCalledWith(
            expect.objectContaining({id: 'a1'}), {id: 'a1', name: 'Ada'}, 'agent', '', 'main', undefined
        );
        expect(llm.invoke.mock.calls[0]![1]).toEqual({cacheable: 'cacheable', dynamic: 'dynamic'});
    });

    test('streams the text of the turn to the handler', async () => {
        const {loop, llm, handler} = newLoop();
        llm.responses = [{transitionReason: 'endLoop', text: 'streamed'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(handler.onStreamText).toHaveBeenCalledWith(expect.objectContaining({
            browserId: 'b1', text: 'streamed'
        }));
    });

    test('walks the loop hooks of a turn', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        const emitted = mocks.emitVisitor.mock.calls.map(call => call[0]);
        expect(emitted).toEqual(['preLoopStart', 'preTurnStart', 'postTurnEnd', 'postLoopEnd']);
    });

    test('marks the session as running and saves the history at the end', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.updateSessionRuntime).toHaveBeenCalledWith(expect.anything(), {status: 'running'});
        expect(mocks.saveHistory).toHaveBeenLastCalledWith(
            expect.anything(), expect.anything(),
            {finalText: 'done', usage: {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3}},
            true
        );
    });

    /**
     * Named where the question still is one. By the time a conversation is closed, what was first
     * asked of it is buried in a history whose shape belongs to the protocol rather than to us.
     */
    test('offers the question as the name of the conversation it starts', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('why is the build slow?', {browserId: 'b1'});
        expect(mocks.nameSession)
            .toHaveBeenCalledExactlyOnceWith(expect.anything(), 'why is the build slow?');
    });

    test('offers the name before the first hook of the turn can read the session', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.nameSession.mock.invocationCallOrder[0]!)
            .toBeLessThan(mocks.emitVisitor.mock.invocationCallOrder[0]!);
    });

    test('compacts the old tool results before every llm call', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.compactOldResults).toHaveBeenCalledOnce();
        expect(mocks.compactFullHistory).toHaveBeenCalledOnce();
    });

    test('skips the result compaction of an outdated session', async () => {
        const {loop, llm} = newLoop({outdated: true});
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.compactOldResults).not.toHaveBeenCalled();
        expect(loop.isOutdated()).toBe(false);
    });

    test('tells the session which protocol its history holds once it has been migrated', async () => {
        const {loop, llm} = newLoop({outdated: true});
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.markHistoryProtocol).toHaveBeenCalledWith(expect.anything(), 'OpenAIChat');
    });

    /**
     * The summary lives in memory until the turn ends, a whole llm call and every tool of it away.
     * A session saying it migrated while the messages on disk are still the old ones is the same
     * conversation refused for good, whether what came in between was a stop or a machine going down.
     */
    test('writes the migrated history out before the session is told of the protocol', async () => {
        const {loop, llm} = newLoop({outdated: true});
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        const forced = mocks.saveHistory.mock.calls.findIndex(call => call[3] === true);
        const savedAt = mocks.saveHistory.mock.invocationCallOrder[forced];
        expect(savedAt).toBeDefined();
        expect(savedAt!).toBeLessThan(mocks.markHistoryProtocol.mock.invocationCallOrder[0]!);
    });

    test('says nothing of the protocol of a session it never migrated', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.markHistoryProtocol).not.toHaveBeenCalled();
    });

    /**
     * The whole of the durability of a migration: it takes an llm call, a stop can land in that
     * call, and a session told the migration was done while its messages are still in the shape of
     * the model before it holds a conversation nothing can be added to -- the run after it compacts
     * nothing, sends what is there, and is answered with an error, for good.
     */
    test('leaves the session on the old protocol when the migration was stopped', async () => {
        const {loop} = newLoop({outdated: true});
        const controller = new AbortController();
        mocks.compactFullHistory.mockImplementationOnce(async () => {
            controller.abort();
            throw new Error('This operation was aborted');
        });
        await loop.runInvoke('hi', {browserId: 'b1', abortSignal: controller.signal});
        expect(mocks.markHistoryProtocol).not.toHaveBeenCalled();
        expect(loop.isOutdated()).toBe(true);
    });

    /**
     * The other way a migration comes back having done nothing: the summarizer refused, or was
     * refused itself, and the history is still every old message it was. A summary is the whole of
     * the conversion, so no summary is no conversion -- and the mark is the one thing that decides
     * whether anything ever tries again.
     */
    test('leaves the session on the old protocol when the summary came back unusable', async () => {
        const {loop, llm} = newLoop({outdated: true});
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        mocks.compactFullHistory.mockResolvedValueOnce(false);
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.markHistoryProtocol).not.toHaveBeenCalled();
        expect(loop.isOutdated()).toBe(true);
    });
});

describe('tool use', () => {

    test('runs the requested tools and feeds the results back into the history', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [
            {transitionReason: 'toolUse', text: 'calling', toolUses: [toolUse('tu1'), toolUse('tu2', 'other')]},
            {transitionReason: 'endLoop', text: 'finished'},
        ];
        const {text} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.executeToolCall).toHaveBeenCalledTimes(2);
        expect(savedHistory().filter(message => message.role === 'tool').map(message => message.text))
            .toEqual(['demo done', 'other done']);
        expect(text).toBe('finished');
        expect(llm.invoke).toHaveBeenCalledTimes(2);
    });

    test('announces every tool call to the hooks', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('tu1')]},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.emitVisitor.mock.calls.map(call => call[0]))
            .toContain('preEachToolUse');
        expect(mocks.emitInterceptor).toHaveBeenCalledWith('preEachToolUse', expect.anything(), toolUse('tu1'));
        expect(mocks.emitVisitor.mock.calls.map(call => call[0])).toContain('postEachToolUse');
    });

    test('reports the reason instead of running a tool an interceptor stopped', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('tu1')]},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        mocks.emitInterceptor.mockResolvedValue({result: 'stop', stopReason: 'command not allowed'});
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.executeToolCall).not.toHaveBeenCalled();
        expect(savedHistory().filter(message => message.role === 'tool').map(message => message.text))
            .toEqual(['command not allowed']);
    });

    test('skips the remaining tools once the agent decided to stop', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{transitionReason: 'toolUse', toolUses: [toolUse('tu1'), toolUse('tu2')]}];
        mocks.executeToolCall.mockImplementationOnce(async (def, context) => {
            (context as {runtime: AgentRuntime}).runtime.agentBreakReason = 'projectCreated';
            return {result: {id: def.id, content: 'created'}, success: true};
        });
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.executeToolCall).toHaveBeenCalledOnce();
        const toolTexts = savedHistory().filter(message => message.role === 'tool').map(message => message.text);
        expect(toolTexts[1]).toContain('Tool call execution skipped');
    });

    /** A tool nobody was there to answer for is one failed call, and the run goes on without it. */
    test('runs the rest of the tools when one of them got no answer from the user', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('tu1'), toolUse('tu2')]},
            {transitionReason: 'endLoop', text: 'went on'},
        ];
        mocks.executeToolCall.mockImplementationOnce(async (def) => ({
            result: {id: def.id, content: 'nobody answered in time'}, success: false
        }));
        const {text} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.executeToolCall).toHaveBeenCalledTimes(2);
        expect(text).toBe('went on');
        expect(savedHistory().filter(message => message.role === 'tool').map(message => message.text))
            .toEqual(['nobody answered in time', 'demo done']);
    });
});

describe('parallel tool use', () => {

    test('runs the tool calls of one group at the same time', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('tu1'), toolUse('tu2', 'other')]},
            {transitionReason: 'endLoop', text: 'finished'},
        ];
        mocks.planExecutionGroups.mockImplementation(defs => [defs]);
        let running = 0;
        let overlapped = false;
        mocks.executeToolCall.mockImplementation(async (def) => {
            running++;
            await Promise.resolve();
            overlapped ||= running > 1;
            running--;
            return {result: {id: def.id, content: `${def.name} done`}, success: true};
        });
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(overlapped).toBe(true);
        expect(savedHistory().filter(message => message.role === 'tool').map(message => message.text))
            .toEqual(['demo done', 'other done']);
    });

    test('waits for a group before starting the next one', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('tu1'), toolUse('tu2')]},
            {transitionReason: 'endLoop', text: 'finished'},
        ];
        mocks.planExecutionGroups.mockImplementation(defs => defs.map(def => [def]));
        let running = 0;
        let overlapped = false;
        mocks.executeToolCall.mockImplementation(async (def) => {
            running++;
            await Promise.resolve();
            overlapped ||= running > 1;
            running--;
            return {result: {id: def.id, content: `${def.name} done`}, success: true};
        });
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(overlapped).toBe(false);
    });

    /** A call that failed says so among the others, and the groups behind it are still run. */
    test('keeps the results of the siblings of a tool call that failed', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{
            transitionReason: 'toolUse',
            toolUses: [toolUse('tu1'), toolUse('tu2'), toolUse('tu3')],
        }];
        mocks.planExecutionGroups.mockImplementation(defs => [defs.slice(0, 2), defs.slice(2)]);
        mocks.executeToolCall.mockImplementation(async (def) => def.id === 'tu1'
            ? {result: {id: def.id, content: 'needs the user'}, success: false}
            : {result: {id: def.id, content: `${def.id} done`}, success: true});
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(savedHistory().filter(message => message.role === 'tool').map(message => message.text))
            .toEqual(['needs the user', 'tu2 done', 'tu3 done']);
    });
});

describe('turn limit', () => {

    /** A model with a word to say and a tool to call every turn, which runs until it is stopped. */
    function streamingToTheLimit(llm: FakeLLM): void {
        llm.invoke.mockImplementation(async (...args) => {
            args[3]('still going. ');
            args[2].push({role: 'assistant', text: 'still going. '});
            return {transitionReason: 'toolUse', toolUses: [toolUse('tu1')]};
        });
    }

    test('ends the run with the final text once the turns are spent', async () => {
        const {loop, llm, handler} = newLoop();
        llm.invoke.mockImplementation(async (...args) => {
            args[2].push({role: 'assistant', text: 'still going'});
            return {transitionReason: 'toolUse', toolUses: [toolUse('tu1')]};
        });
        const {text, runtime} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(runtime.turnCount).toBe(100);
        expect(text).toContain('agent.maxTurnReached');
        expect(handler.onStreamText).toHaveBeenCalledWith(expect.objectContaining({browserId: 'b1'}));
    });

    /**
     * The same way round as every other ending: the last of the run, and the notice under it. A run
     * out of turns is one stopped in the middle of a tool call, so the last of it is as often a
     * result as a sentence -- which is the case in `endOfRun` too, and the reason to word the two
     * alike: written the other way here, this branch is as likely to be the one an ending added
     * later is copied from, and the two shapes would read as if the difference meant something.
     */
    // 交出去的答案是「这轮最后落下的 + 空行 + 中止说明」，和别处的结束语一个形状
    test('hands out the last of the run with the notice under it', async () => {
        const {loop, llm} = newLoop();
        streamingToTheLimit(llm);
        const {text} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(text).toBe('demo done\n\nagent.maxTurnReached');
    });

    /** The chat read those words as they were written and has no use for a second copy of them. */
    // 聊天里只补一句中止说明，不再把最后那段重抄一遍
    test('leaves the chat the notice alone, the words of the run being there already', async () => {
        const {loop, llm} = newLoop();
        streamingToTheLimit(llm);
        const {said} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(said).toBe(`${'still going. '.repeat(100)}\n\nagent.maxTurnReached`);
    });

    /**
     * The one ending the loop puts words of its own on the stream, so it is the one place the two
     * can come apart: sent whole, the notice carries the last thing the model said, and a stream
     * being added to rather than replaced would show that paragraph twice from the moment the run
     * ended until the message written from `said` landed over it.
     */
    // 流上补的和最终落盘的是同一段，中间不会先重一遍再被覆盖回去
    test('reads on the screen as what is written down, at the moment it is written', async () => {
        const {loop, llm, handler} = newLoop();
        streamingToTheLimit(llm);
        const {said} = await loop.runInvoke('hi', {browserId: 'b1'});
        const onScreen = vi.mocked(handler.onStreamText).mock.calls
            .map(call => call[0].text).join('');
        expect(onScreen).toBe(said);
    });
});

/**
 * A run is read in two places and they want two different things of it. The chat watched it happen
 * and holds every word already, so an answer written there has to be all of them: written short, it
 * would take the run off the screen as it ended and put it back on the next reload, the file having
 * the whole of it all along. An answer carried to IM or standing under a closed conversation is
 * read by somebody who watched none of it, and there the last word is the answer.
 */
describe('what a run leaves behind', () => {

    // 一轮跑完：聊天里留下全程，交出去的是最后那句
    test('says the last word and leaves behind every word', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [
            {transitionReason: 'toolUse', text: 'reading the file. ', toolUses: [toolUse('tu1')]},
            {transitionReason: 'endLoop', text: 'fixed the typo.'},
        ];
        const {text, said} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(text).toBe('fixed the typo.');
        expect(said).toBe('reading the file. fixed the typo.');
    });

    /**
     * Everything downstream reads the run off `said`, which the stream fills. An adapter with no
     * stream in it would leave that empty and every reading of the run with it: the chat written
     * from `said` would hold the ending alone, and the reader handed the answer -- read off the
     * history instead -- would have more of the run than the one who sat and watched it.
     */
    // 适配器不走流、只在响应里给文字时，说过的话照样进聊天和屏幕
    test('takes the words of an adapter that streams none of them', async () => {
        const {loop, llm, handler} = newLoop();
        llm.invoke.mockImplementation(async (...args) => {
            args[2].push({role: 'assistant', text: 'quietly done'});
            return {transitionReason: 'toolUse', toolUses: [toolUse('tu1')]};
        });
        mocks.executeToolCall.mockImplementationOnce(async (def, context) => {
            (context as {runtime: AgentRuntime}).runtime.agentBreakReason = 'projectCreated';
            return {result: {id: def.id, content: 'created'}, success: true};
        });
        const {said} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(said).toBe('quietly done\n\nagent.agentBreak.agentStop.projectCreated.user');
        expect(handler.onStreamText)
            .toHaveBeenCalledWith(expect.objectContaining({browserId: 'b1', text: 'quietly done'}));
    });

    /**
     * The other side of the same question: a call the llm refused pushes nothing, so what lies
     * last in the history is whatever the turn opened on -- the user's own question here, a whole
     * summary after a compaction, the line asking the model to carry on from an output limit. Read
     * as words handed back without being streamed, any of those would be played onto the screen as
     * the agent speaking and written into the chat as that.
     */
    // 被拒的那轮什么也没往历史里推，上一条消息不是模型说的话
    test('takes nothing from a call the llm refused', async () => {
        const {loop, llm, handler} = newLoop();
        llm.responses = [
            {transitionReason: 'inputMaxTokens'},
            {transitionReason: 'endLoop', text: 'answered at last'},
        ];
        const {said} = await loop.runInvoke('what did i ask', {browserId: 'b1'});
        expect(said).toBe('answered at last');
        // The one frame of the run, the refused call having put nothing on the stream either.
        expect(handler.onStreamText).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({text: 'answered at last'})
        );
    });

    /**
     * The stream is read in one shape and the file is written in another otherwise: what goes out
     * has its line endings evened out, and a copy kept of the raw text would put the message a
     * hair off what was watched being written. Blank lines at the end go the same way, once, where
     * the last event of a stream drops them.
     */
    // 落盘的和流上出去的一个形状：CRLF 归一，末尾空行去掉
    test('writes down what the stream carried, to the line ending', async () => {
        const {loop, llm, handler} = newLoop();
        llm.responses = [{transitionReason: 'endLoop', text: 'first\r\nsecond\n\n'}];
        const {said} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(said).toBe('first\nsecond');
        expect(handler.onStreamText).toHaveBeenCalledWith(
            expect.objectContaining({browserId: 'b1', text: 'first\nsecond\n\n'})
        );
    });

    /** The notice is the one part of an ending that never went out over the stream. */
    // 工具中止 run 时给的说明没走过流，两边都得补上
    test('adds the notice of an ending to both, the stream having carried neither', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{
            transitionReason: 'toolUse', text: 'setting it up. ', toolUses: [toolUse('tu1')],
        }];
        mocks.executeToolCall.mockImplementationOnce(async (def, context) => {
            const runtime = (context as {runtime: AgentRuntime}).runtime;
            runtime.agentBreakReason = 'projectCreated';
            runtime.agentBreakDetail = 'project p1 is ready';
            return {result: {id: def.id, content: 'created'}, success: true};
        });
        const {text, said} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(text).toBe('project p1 is ready');
        expect(said).toBe('setting it up. \n\nproject p1 is ready');
    });

    /** What broke is worth reading under the work that got as far as it did. */
    // run 半路炸了：说过的话还在，错误接在后面
    test('keeps what a run said before it broke, with the failure after it', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{
            transitionReason: 'toolUse', text: 'started well', toolUses: [toolUse('tu1')],
        }];
        llm.invoke.mockImplementationOnce(llm.invoke.getMockImplementation()!);
        llm.invoke.mockRejectedValueOnce(new Error('llm exploded'));
        const {text, said} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(text).toBe('Error in loop, llm exploded');
        expect(said).toBe('started well\n\nError in loop, llm exploded');
    });

    /** A stop has no answer of its own: what there is of the run is what both are given. */
    // 被停掉的 run 没有自己的答案，两边给的都是说过的加一句说明
    test('answers a stopped run with the run itself', async () => {
        const {loop, llm} = newLoop();
        const controller = new AbortController();
        llm.invoke.mockImplementationOnce(async (...args) => {
            args[3]('halfway through');
            controller.abort();
            throw new Error('This operation was aborted');
        });
        const {text, said} = await loop.runInvoke(
            'hi', {browserId: 'b1', abortSignal: controller.signal}
        );
        const stopped = 'halfway through\n\nagent.agentBreak.externalInterrupt.userStopped.user';
        expect(text).toBe(stopped);
        expect(said).toBe(stopped);
    });
});

describe('recovery', () => {

    test('asks the llm to continue when it ran out of output tokens', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [
            {transitionReason: 'maxTokens', text: 'half a sen'},
            {transitionReason: 'endLoop', text: 'tence done'},
        ];
        const {runtime} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(savedHistory().some(message => message.text.includes('Output limit hit'))).toBe(true);
        // Back to nothing once the next call came back whole: what is counted is a recovery that
        // is not recovering, and this one recovered.
        expect(runtime.recoveryState.maxTokenRetries).toBe(0);
    });

    test('gives up after three output limit retries', async () => {
        const {loop, llm} = newLoop();
        llm.responses = Array.from({length: 3}, () => ({transitionReason: 'maxTokens' as LLMTransitionReason}));
        const {runtime} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(runtime.recoveryState.maxTokenRetries).toBe(3);
        expect(runtime.transitionReason).toBe('error');
    });

    test('compacts the history when the input got too long', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [
            {transitionReason: 'inputMaxTokens'},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.compactFullHistory).toHaveBeenCalledTimes(3);
    });

    test('forces the compaction the refused call asked for, whatever the history measures', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [
            {transitionReason: 'inputMaxTokens'},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.compactFullHistory.mock.calls.map(call => call[0]))
            .toEqual([false, true, false]);
    });

    /** Two compactions and the third refusal, the increment coming before the comparison. */
    test('gives up on the third refusal in a row rather than summarizing to the turn limit', async () => {
        const {loop, llm} = newLoop();
        llm.responses = Array.from(
            {length: 3}, () => ({transitionReason: 'inputMaxTokens' as LLMTransitionReason})
        );
        const {runtime} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(runtime.recoveryState.inputMaxTokenRetries).toBe(3);
        expect(runtime.transitionReason).toBe('error');
        expect(runtime.turnCount).toBe(3);
    });

    test('says why it gave up instead of handing back what the compaction left behind', async () => {
        // The llm keeps a refusal out of the history so the compaction has an untouched
        // conversation to work on, which leaves the user's own question as the last thing in it.
        const {loop, llm} = newLoop();
        llm.responses = Array.from(
            {length: 3}, () => ({transitionReason: 'inputMaxTokens' as LLMTransitionReason})
        );
        const {text} = await loop.runInvoke('what did i ask', {browserId: 'b1'});
        expect(text).toBe('agent.contextTooLong');
    });

    test('counts refusals in a row, not refusals in a run', async () => {
        // A conversation that outgrows the window, is summarized, runs on and outgrows it again is
        // a conversation working as intended, not one failing three times. The counter is there
        // for a compaction that does not compact, which is a thing that happens back to back.
        const {loop, llm} = newLoop();
        llm.responses = [
            {transitionReason: 'inputMaxTokens'},
            {transitionReason: 'toolUse', toolUses: [toolUse('tu1')]},
            {transitionReason: 'inputMaxTokens'},
            {transitionReason: 'toolUse', toolUses: [toolUse('tu2')]},
            {transitionReason: 'inputMaxTokens'},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        const {text, runtime} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(text).toBe('done');
        expect(runtime.transitionReason).toBe('endLoop');
        expect(runtime.recoveryState.inputMaxTokenRetries).toBe(0);
    });

    test('does not let two limits taking turns clear each other forever', async () => {
        // Alternating between the input limit and the output limit is not a recovery, and were
        // each counter cleared by the other firing, neither would ever reach three: the only
        // thing left to end the run would be the turn limit, a hundred llm calls away.
        const {loop, llm} = newLoop();
        llm.responses = [
            {transitionReason: 'inputMaxTokens'},
            {transitionReason: 'maxTokens'},
            {transitionReason: 'inputMaxTokens'},
            {transitionReason: 'maxTokens'},
            {transitionReason: 'inputMaxTokens'},
        ];
        const {runtime} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(runtime.transitionReason).toBe('error');
        expect(runtime.turnCount).toBeLessThan(6);
    });

    test('counts output limits in a row too', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [
            {transitionReason: 'maxTokens'},
            {transitionReason: 'toolUse', toolUses: [toolUse('tu1')]},
            {transitionReason: 'maxTokens'},
            {transitionReason: 'toolUse', toolUses: [toolUse('tu2')]},
            {transitionReason: 'maxTokens'},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        const {runtime} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(runtime.transitionReason).toBe('endLoop');
        expect(runtime.recoveryState.maxTokenRetries).toBe(0);
    });

    test('records the size of a call that went through, cached tokens and all', async () => {
        // The cache makes those tokens cheaper, not absent. Leaving them out would have a long
        // conversation read smaller than it is by exactly the part it is mostly made of.
        const {loop, llm} = newLoop();
        llm.usage = {cachedInputTokens: 300000, noCachedInputTokens: 100048, outputTokens: 12};
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.observeAccepted).toHaveBeenCalledWith('a1', 'test-model', 400048);
    });

    /**
     * A window is a fact about an endpoint, and the endpoint of a task worked on somebody else's
     * model is theirs. Filed under the name on the run, what this turn found out would be learned
     * by an agent that never made the call, and the one that did would find it out again on every
     * task it is ever handed.
     */
    test('learns the window of a borrowed model for the agent whose model it is', async () => {
        const {loop, llm} = newLoop({
            spawned: newSpawned('task', {projectId: 'p1', taskId: 'ship-it'}),
            config: newTestAgentConfig({id: 'a2'}),
        });
        llm.usage = {cachedInputTokens: 300, noCachedInputTokens: 700, outputTokens: 5};
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('go', {browserId: 'b1'});
        expect(mocks.budgetOf).toHaveBeenCalledWith('a2', 'test-model');
        expect(mocks.observeAccepted).toHaveBeenCalledExactlyOnceWith('a2', 'test-model', 1000);
    });

    test('records the limit a refusal named instead of the zeros it came back with', async () => {
        // A refused call answers with a made-up response whose usage is empty. Nothing was
        // carried, so there is no width to prove, and reading it as one would floor the bound.
        const {loop, llm} = newLoop();
        llm.responses = [
            {transitionReason: 'inputMaxTokens', observedLimit: {tokens: 983616}},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.observeRefused)
            .toHaveBeenCalledWith('a1', 'test-model', {tokens: 983616}, expect.any(Number));
        expect(mocks.observeAccepted).not.toHaveBeenCalledWith('a1', 'test-model', 0);
    });

    test('hands a refusal that named nothing an estimate of what was refused', async () => {
        // An openai-compatible proxy answers {"message":"context length exceeded"} with no figure
        // anywhere in it. Recorded as nothing, that refusal leaves the budget above the wall it
        // just hit, the whole history goes to the summarizer, and three of those end the
        // conversation for good. The estimate is the only figure there is to narrow against.
        const {loop, llm} = newLoop();
        llm.responses = [
            {transitionReason: 'inputMaxTokens', observedLimit: {}},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        await loop.runInvoke('hi', {browserId: 'b1'});
        const call = mocks.observeRefused.mock.calls[0]!;
        expect(call[2]).toEqual({});
        expect(call[3]).toBeGreaterThan(0);
    });

    test('does not summarize the summary the turn after a refusal', async () => {
        // The refused turn is by definition over the margin, that being why it was refused, and
        // its size would otherwise be weighed against the two messages the forced compaction left
        // behind. What is known about the size of the next request after a compaction is nothing.
        const {loop, llm} = newLoop();
        mocks.budgetOf.mockReturnValue({tokens: 160000, bytes: 150000});
        llm.usage = {cachedInputTokens: 175000, noCachedInputTokens: 0, outputTokens: 5};
        llm.responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('tu1')]},
            {transitionReason: 'inputMaxTokens', observedLimit: {tokens: 200000}},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        await loop.runInvoke('hi', {browserId: 'b1'});
        // Nothing known yet, then the turn that really is over budget, then the forced one the
        // refusal asked for -- and then nothing, where the stale measurement would have compacted
        // the two messages that compaction had just left behind.
        expect(mocks.compactFullHistory.mock.calls.map(call => call[0]))
            .toEqual([false, true, true, false]);
    });

    test('compacts once the last call filled more of the window than the budget allows', async () => {
        const {loop, llm} = newLoop();
        mocks.budgetOf.mockReturnValue({tokens: 1000, bytes: 150000});
        llm.usage = {cachedInputTokens: 900, noCachedInputTokens: 200, outputTokens: 5};
        llm.responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('tu1')]},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        mocks.executeToolCall.mockResolvedValue({result: {id: 'tu1', content: 'ok'}, success: true});
        await loop.runInvoke('hi', {browserId: 'b1'});
        // Nothing is known before the first call, so the first check cannot fire; the second sees
        // what that call came to.
        expect(mocks.compactFullHistory.mock.calls.map(call => call[0])).toEqual([false, true]);
    });

    test('leaves the history alone while it fits inside the budget', async () => {
        const {loop, llm} = newLoop();
        mocks.budgetOf.mockReturnValue({tokens: 1000, bytes: 150000});
        llm.usage = {cachedInputTokens: 400, noCachedInputTokens: 100, outputTokens: 5};
        llm.responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('tu1')]},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        mocks.executeToolCall.mockResolvedValue({result: {id: 'tu1', content: 'ok'}, success: true});
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.compactFullHistory.mock.calls.map(call => call[0])).toEqual([false, false]);
    });

    test('lets a request go out larger than the budget, which is how the window gets found', async () => {
        // The gate weighs the request that was already answered, so the first one of a run is not
        // weighed at all and a later one is weighed a turn late. Those are the requests that prove
        // the window wider than the budget; weighed as it stands, the history would be bound every
        // turn and nothing would ever prove anything.
        const {loop, llm} = newLoop();
        mocks.budgetOf.mockReturnValue({tokens: 1000, bytes: 4 * 1024 * 1024});
        llm.usage = {cachedInputTokens: 3000, noCachedInputTokens: 2000, outputTokens: 5};
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.compactFullHistory.mock.calls.map(call => call[0])).toEqual([false]);
        expect(mocks.observeAccepted).toHaveBeenCalledWith('a1', 'test-model', 5000);
    });

    test('hands the budget down to the compaction, which weighs the request itself', async () => {
        const {loop, llm} = newLoop();
        mocks.budgetOf.mockReturnValue({tokens: 786892, bytes: 5033164});
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1'});
        expect(mocks.compactFullHistory.mock.calls[0]![5])
            .toEqual({tokens: 786892, bytes: 5033164});
    });

    test('turns a failure inside the loop into an error transition', async () => {
        const {loop, llm} = newLoop();
        llm.invoke.mockRejectedValueOnce(new Error('llm exploded'));
        const {text, runtime} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(text).toBe('Error in loop, llm exploded');
        expect(runtime.transitionReason).toBe('error');
        expect(mocks.saveHistory).toHaveBeenCalled();
    });

    test('falls back to a generic message when a failed turn left no text', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{transitionReason: 'error'}];
        const {text} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(text).toBe('common.unexpected');
        expect(mocks.emitVisitor.mock.calls.map(call => call[0])).toContain('turnError');
    });
});

describe('interrupts', () => {

    test('stops the loop when the browser was lost', async () => {
        const {loop, llm} = newLoop();
        llm.invoke.mockImplementationOnce(async (...args) => {
            loop.setExternalInterruptReason('clientLost');
            args[2].push({role: 'assistant', text: 'working'});
            return {transitionReason: 'toolUse', toolUses: []};
        });
        const {text, runtime} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(runtime.agentBreakReason).toBe('clientLost');
        expect(text).toContain('agent.agentBreak.externalInterrupt.clientLost.user');
        expect(llm.invoke).toHaveBeenCalledOnce();
        expect(mocks.emitVisitor.mock.calls.map(call => call[0])).toContain('externalInterrupt');
    });

    test('forgets a pending interrupt once the llm ended the loop by itself', async () => {
        const {loop, llm} = newLoop();
        llm.invoke.mockImplementationOnce(async (...args) => {
            loop.setExternalInterruptReason('clientLost');
            args[2].push({role: 'assistant', text: 'all done'});
            return {transitionReason: 'endLoop'};
        });
        const {text, runtime} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(runtime.agentBreakReason).toBeUndefined();
        expect(text).toBe('all done');
    });

    test('explains an agent stop with the detail it was given', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{transitionReason: 'toolUse', toolUses: [toolUse('tu1')]}];
        mocks.executeToolCall.mockImplementationOnce(async (def, context) => {
            const runtime = (context as {runtime: AgentRuntime}).runtime;
            runtime.agentBreakReason = 'projectCreated';
            runtime.agentBreakDetail = 'project p1 is ready';
            return {result: {id: def.id, content: 'created'}, success: true};
        });
        const {text} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(text).toBe('project p1 is ready');
    });

    test('falls back to the standard wording of an agent stop', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{transitionReason: 'toolUse', text: 'created it', toolUses: [toolUse('tu1')]}];
        mocks.executeToolCall.mockImplementationOnce(async (def, context) => {
            (context as {runtime: AgentRuntime}).runtime.agentBreakReason = 'taskPause';
            return {result: {id: def.id, content: 'paused'}, success: true};
        });
        const {text} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(text).toContain('agent.agentBreak.agentStop.taskPause.user');
    });
});

/**
 * The stop button, from the loop down. The signal is what cuts short whatever the run is waiting
 * on; turning that into an ending the loop words rather than a failure it reports is this layer.
 */
describe('stopping a run', () => {

    /** A run stopped while it waits on the model, which is where most of a turn is spent. */
    function stopDuring(
        llm: FakeLLM, controller: AbortController, said: string = ''
    ): void {
        llm.invoke.mockImplementationOnce(async (...args) => {
            args[3](said);
            controller.abort();
            throw new Error('This operation was aborted');
        });
    }

    test('hands the signal of the run to the llm', async () => {
        const {loop, llm} = newLoop();
        const abortSignal = new AbortController().signal;
        await loop.runInvoke('hi', {browserId: 'b1', abortSignal});
        expect(llm.invoke.mock.calls[0]![5]).toBe(abortSignal);
    });

    test('ends as a stop rather than as an error when the signal fires in the llm call', async () => {
        const {loop, llm} = newLoop();
        const controller = new AbortController();
        stopDuring(llm, controller);
        const {text, runtime} = await loop.runInvoke(
            'hi', {browserId: 'b1', abortSignal: controller.signal}
        );
        expect(runtime.agentBreakReason).toBe('userStopped');
        expect(runtime.transitionReason).not.toBe('error');
        expect(text).toBe('agent.agentBreak.externalInterrupt.userStopped.user');
        expectValidHistory(savedHistory());
    });

    /**
     * Compaction is itself a call to the model, and the slowest one a long conversation makes, so
     * it is exactly where a stop is worth something. A catch drawn around the llm call alone would
     * let this one out as a failure: an error bubble, and the conversation left saying it broke.
     */
    test('ends as a stop when the signal fires inside the compaction of the history', async () => {
        const {loop} = newLoop();
        const controller = new AbortController();
        mocks.compactFullHistory.mockImplementationOnce(async () => {
            controller.abort();
            throw new Error('This operation was aborted');
        });
        const {text, runtime} = await loop.runInvoke(
            'hi', {browserId: 'b1', abortSignal: controller.signal}
        );
        expect(runtime.agentBreakReason).toBe('userStopped');
        expect(runtime.transitionReason).not.toBe('error');
        expect(text).toBe('agent.agentBreak.externalInterrupt.userStopped.user');
        expectValidHistory(savedHistory());
    });

    test('leaves a real failure on the error path, the signal never having fired', async () => {
        const {loop, llm} = newLoop();
        const controller = new AbortController();
        llm.invoke.mockRejectedValueOnce(new Error('llm exploded'));
        const {text, runtime} = await loop.runInvoke(
            'hi', {browserId: 'b1', abortSignal: controller.signal}
        );
        expect(text).toBe('Error in loop, llm exploded');
        expect(runtime.transitionReason).toBe('error');
        expect(runtime.agentBreakReason).toBeUndefined();
    });

    test('lets an answer that arrived stand, though the signal fired while it was arriving', async () => {
        const {loop, llm} = newLoop();
        const controller = new AbortController();
        llm.invoke.mockImplementationOnce(async (...args) => {
            controller.abort();
            args[2].push({role: 'assistant', text: 'all done'});
            return {transitionReason: 'endLoop'};
        });
        const {text, runtime} = await loop.runInvoke(
            'hi', {browserId: 'b1', abortSignal: controller.signal}
        );
        expect(runtime.agentBreakReason).toBeUndefined();
        expect(text).toBe('all done');
    });

    /**
     * A stop is set as a flag on the loop it was addressed to, which is only ever the topmost one.
     * A loop spawned by it is never told, so the signal is the whole of what it has: without it
     * read here, a subagent could only throw its way out and be reported as broken.
     */
    test('ends a spawned loop on the signal alone, which is all one is ever given', async () => {
        const {loop} = newLoop();
        const subLoop = loop.newTestSubLoop();
        const controller = new AbortController();
        stopDuring(subLoop.fakeLLM(), controller);
        const {runtime} = await subLoop.runInvoke(
            'work', {browserId: 'b1', abortSignal: controller.signal}
        );
        expect(runtime.agentBreakReason).toBe('userStopped');
        expect(runtime.transitionReason).not.toBe('error');
    });

    test('keeps the half of an answer that was streamed, in the chat and in the history alike', async () => {
        const {loop, llm} = newLoop();
        const controller = new AbortController();
        stopDuring(llm, controller, 'I was about to say');
        const {text} = await loop.runInvoke('hi', {browserId: 'b1', abortSignal: controller.signal});
        expect(text).toBe('I was about to say\n\nagent.agentBreak.externalInterrupt.userStopped.user');
        expect(savedHistory().at(-1))
            .toEqual({role: 'assistant', text: 'I was about to say'});
        expectValidHistory(savedHistory());
    });

    /**
     * A run is answered with every word it said, not with the words of its last turn. A turn
     * opened after a tool call is one the model may enter with nothing to say yet, and a stop
     * landing there answers with a notice that replaces the message on the screen: read from that
     * turn alone, it would take back everything the run had already put there, though the tools it
     * ran all finished and the words are in the history to this day.
     */
    test('reads back what the whole run said, not what the turn the stop landed in did', async () => {
        const {loop, llm} = newLoop();
        const controller = new AbortController();
        llm.responses = [{
            transitionReason: 'toolUse',
            text: 'let me read those five files',
            toolUses: [toolUse('tu1')],
        }];
        // The first turn runs on the default fake, tools and all, so that the stop lands in the
        // turn after it, before the model has said a word in that one.
        llm.invoke.mockImplementationOnce(llm.invoke.getMockImplementation()!);
        stopDuring(llm, controller);

        const {text} = await loop.runInvoke('hi', {browserId: 'b1', abortSignal: controller.signal});
        expect(text).toBe(
            'let me read those five files\n\nagent.agentBreak.externalInterrupt.userStopped.user'
        );
        expectValidHistory(savedHistory());
    });

    /**
     * A turn cut short pushes no message, and the model will not take one that says nothing, so a
     * line stands in for it. That line is written for the model and must not be read back to the
     * user: the notice they get says the very same thing, and both of them is it said twice.
     */
    test('says the run was stopped once, though the model was left a line saying so too', async () => {
        const {loop, llm} = newLoop();
        const controller = new AbortController();
        stopDuring(llm, controller);
        const {text} = await loop.runInvoke('hi', {browserId: 'b1', abortSignal: controller.signal});
        expect(text).toBe('agent.agentBreak.externalInterrupt.userStopped.user');
        expect(text).not.toContain('agent.agentBreak.externalInterrupt.userStopped.llm');
        expect(savedHistory().at(-1)).toEqual({
            role: 'assistant', text: 'agent.agentBreak.externalInterrupt.userStopped.llm'
        });
    });

    /**
     * Every call the model asked for is owed an answer, and a stop landing in the middle of them
     * is where the debt is easiest to leave. Dropping the calls that had not started would leave a
     * history the next message is refused for, whatever the user goes on to say.
     */
    test('answers every tool call of the turn, though the stop landed in the middle of them', async () => {
        const {loop, llm} = newLoop();
        const controller = new AbortController();
        llm.responses = [{
            transitionReason: 'toolUse',
            text: 'running them',
            toolUses: [toolUse('tu1'), toolUse('tu2'), toolUse('tu3')],
        }];
        mocks.executeToolCall.mockImplementationOnce(async (def) => {
            controller.abort();
            return {result: {id: def.id, content: 'the first one finished'}, success: true};
        });
        const {runtime} = await loop.runInvoke(
            'hi', {browserId: 'b1', abortSignal: controller.signal}
        );
        expect(runtime.agentBreakReason).toBe('userStopped');
        const results = savedHistory().filter(message => message.role === 'tool');
        expect(results.map(message => message.toolResultId)).toEqual(['tu1', 'tu2', 'tu3']);
        expect(results[0]!.text).toBe('the first one finished');
        expect(results[2]!.text)
            .toContain('agent.agentBreak.externalInterrupt.userStopped.llm');
        expectValidHistory(savedHistory());
    });

    /**
     * The one place a skipped call can read its wording from is the break reason, and that is not
     * written until the turn is over. A stop landing while the tools run has to name itself.
     */
    test('names the stop in the skipped calls, the break reason not being written yet', async () => {
        const {loop, llm} = newLoop();
        const controller = new AbortController();
        llm.responses = [{
            transitionReason: 'toolUse', text: 'running them',
            toolUses: [toolUse('tu1'), toolUse('tu2')],
        }];
        mocks.executeToolCall.mockImplementationOnce(async (def) => {
            controller.abort();
            return {result: {id: def.id, content: 'done'}, success: true};
        });
        await loop.runInvoke('hi', {browserId: 'b1', abortSignal: controller.signal});
        const skipped = savedHistory().find(message => message.toolResultId === 'tu2');
        expect(skipped!.text).not.toContain('undefined');
        expect(skipped!.text).toBe(
            'Tool call execution skipped because loop terminated due to: '
            + 'agent.agentBreak.externalInterrupt.userStopped.llm'
        );
    });

    test('reports the conversation as stopped rather than as broken', async () => {
        const {loop, llm} = newLoop();
        const controller = new AbortController();
        stopDuring(llm, controller);
        await loop.runInvoke('hi', {browserId: 'b1', abortSignal: controller.signal});
        const saved = mocks.saveHistory.mock.calls.at(-1)!;
        const context = saved[1] as OneLoopContext;
        expect(context.runtime.agentBreakReason).toBe('userStopped');
        expect(context.runtime.transitionReason).not.toBe('error');
    });
});

describe('spawned loops', () => {

    test('creates a sub loop that shares the ids but has its own session', () => {
        const {loop} = newLoop();
        const subLoop = loop.newTestSubLoop();
        expect(TestLoop.spawnedLoops).toEqual([subLoop]);
        expect(subLoop.fakeLLM().loopKind).toBe('sub');
    });

    test('creates a task loop for the task it hands over', async () => {
        const {loop} = newLoop();
        const taskLoop = await loop.newTestTaskLoop();
        expect(TestLoop.spawnedLoops).toEqual([taskLoop]);
        expect(taskLoop.fakeLLM().loopKind).toBe('task');
    });

    test('gives every run a handle of its own', async () => {
        const {loop} = newLoop();
        await loop.newTestTaskLoop();
        loop.newTestSubLoop();
        const runIds = mocks.getSessionDir.mock.calls
            .map(call => (call[3] as SpawnedLoop | undefined)?.runId)
            .filter(Boolean);
        expect(new Set(runIds).size).toBe(2);
    });

    /** Its text under the loop id they share would read as an answer of the loop that spawned it. */
    test('keeps the stream of a spawned loop private', async () => {
        const {loop, handler} = newLoop();
        for (const spawnedLoop of [loop.newTestSubLoop(), await loop.newTestTaskLoop()]) {
            spawnedLoop.fakeLLM().responses = [{transitionReason: 'endLoop', text: 'an answer'}];
            await spawnedLoop.runInvoke('work', {browserId: 'b1'});
        }
        expect(handler.onStreamText).not.toHaveBeenCalled();
    });

    test('forwards the questions and the events of a sub loop to the user', async () => {
        const {loop, handler} = newLoop();
        const subLoop = loop.newTestSubLoop();
        await subLoop.sealedHandler().onInteractionEvent({type: 'input', content: 'which one?', browserId: 'b1'});
        expect(handler.onInteractionEvent).toHaveBeenCalledWith(expect.objectContaining({content: 'which one?'}));
        subLoop.sealedHandler().onInfoEvent({eventType: 'updateAgent', content: {id: 'a1'}});
        expect(handler.onInfoEvent).toHaveBeenCalled();
    });

    /**
     * A run started in a chat is answered in that chat, and there is nobody at the browser the loop
     * was built to ask. What its subagents want to know belongs to the same conversation.
     */
    test('asks the questions of a sub loop where the run in progress asks', async () => {
        const {loop, handler, llm} = newLoop();
        const askInChat = vi.fn(async () => 'from the chat');
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runInvoke('hi', {browserId: 'b1', agentHandler: {onInteractionEvent: askInChat}});
        const subLoop = loop.newTestSubLoop();
        const answer = subLoop.sealedHandler().onInteractionEvent(
            {type: 'input', content: 'which one?', browserId: 'b1'}
        );
        await expect(answer).resolves.toBe('from the chat');
        expect(handler.onInteractionEvent).not.toHaveBeenCalled();
    });

    test('refuses to nest another sub loop', () => {
        const {loop} = newLoop({spawned: newSpawned('sub')});
        expect(() => loop.createSubLoop()).toThrow('A sub loop cannot create a sub loop.');
    });

    /** The whole point of a task loop: the pieces of one task can go out at the same time. */
    test('lets a task loop spawn sub loops of its own', () => {
        const {loop} = newLoop({spawned: newSpawned('task', {projectId: 'p1', taskId: 'ship-it'})});
        const subLoop = loop.newTestSubLoop();
        expect(subLoop.fakeLLM().loopKind).toBe('sub');
    });

    test('hands the tasks of a project out of the main loop only', async () => {
        const task = {projectId: 'p1', taskId: 'ship-it'};
        await expect(newLoop({spawned: newSpawned('task', task)}).loop.createTaskLoop(task))
            .rejects.toThrow('A task loop cannot create a task loop.');
        await expect(newLoop({spawned: newSpawned('sub')}).loop.createTaskLoop(task))
            .rejects.toThrow('A sub loop cannot create a task loop.');
    });

    test('builds the prompt of a task loop around its task', async () => {
        const {loop} = newLoop();
        const taskLoop = await loop.newTestTaskLoop();
        taskLoop.fakeLLM().responses = [{transitionReason: 'endLoop', text: 'done'}];
        await taskLoop.runInvoke('go', {browserId: 'b1'});
        expect(mocks.provideSystemPrompt).toHaveBeenLastCalledWith(
            expect.anything(), expect.anything(), 'agent', '', 'task',
            {projectId: 'p1', taskId: 'ship-it'}
        );
    });

    test('leaves the prompt of a sub loop without a task alone', async () => {
        const {loop} = newLoop();
        const subLoop = loop.newTestSubLoop();
        subLoop.fakeLLM().responses = [{transitionReason: 'endLoop', text: 'done'}];
        await subLoop.runInvoke('go', {browserId: 'b1'});
        expect(mocks.provideSystemPrompt).toHaveBeenLastCalledWith(
            expect.anything(), expect.anything(), 'agent', '', 'sub', undefined
        );
    });

    /** The tools read the borrowed agent off the context, the prompt only tells the model about it. */
    test('tells the tools of a task loop which agent it stands in for', async () => {
        const {loop} = newLoop();
        assignedTo('a2');
        const taskLoop = await loop.newTestTaskLoop();
        taskLoop.fakeLLM().responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('tu1')]},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        await taskLoop.runInvoke('go', {browserId: 'b1'});
        expect(mocks.taskAssignee).toHaveBeenCalledWith({projectId: 'p1', taskId: 'ship-it'});
        expect(mocks.executeToolCall).toHaveBeenCalledWith(
            toolUse('tu1'), expect.objectContaining({personaId: 'a2', agentId: 'a1'})
        );
    });

    /** A helper of a task loop works for the same agent, with the memory and the skills of it. */
    test('hands the borrowed agent of a task loop down to its sub loops', async () => {
        const {loop} = newLoop({spawned: newSpawned('task', {projectId: 'p1', taskId: 'ship-it'})});
        assignedTo('a2');
        const subLoop = loop.newTestSubLoop();
        subLoop.fakeLLM().responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('tu1')]},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        await subLoop.runInvoke('go', {browserId: 'b1'});
        expect(mocks.executeToolCall).toHaveBeenCalledWith(
            toolUse('tu1'), expect.objectContaining({personaId: 'a2', agentId: 'a1'})
        );
    });

    test('leaves the tools of a task loop on a task nobody owns with their own agent', async () => {
        const {loop} = newLoop();
        const taskLoop = await loop.newTestTaskLoop();
        taskLoop.fakeLLM().responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('tu1')]},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        await taskLoop.runInvoke('go', {browserId: 'b1'});
        expect(mocks.executeToolCall).toHaveBeenCalledWith(
            toolUse('tu1'), expect.objectContaining({personaId: undefined, agentId: 'a1'})
        );
    });

    /**
     * The model of the agent a task belongs to does the work, so the loop is built where the class
     * of it can be picked off that agent's endpoint. What it is asked for names the loop handing
     * the task over, and only the config comes from the assignee.
     */
    test('works a task on the model of the agent it belongs to', async () => {
        const {loop} = newLoop();
        assignedTo('a2');
        await loop.newTestTaskLoop();
        expect(mocks.getSpawnedLoop).toHaveBeenCalledOnce();
        const [role, agentId, projectId, , spawned] = mocks.getSpawnedLoop.mock.calls[0]!;
        expect([role, agentId, projectId]).toEqual(['agent', 'a1', '']);
        expect(spawned).toEqual({
            kind: 'task', runId: expect.any(String), assignedTask: {projectId: 'p1', taskId: 'ship-it'},
            runAs: 'a2', permissionWhiteList: expect.any(Set),
        });
        expect(mocks.loadAgentConfig).toHaveBeenLastCalledWith('a2');
    });

    /**
     * The one thing that may not travel with the model. Every event of a spawned run is stamped
     * with the id of the loop it was built under, and that is what the page watching this
     * conversation matches a question against: under an id of its own, a subagent working for
     * somebody else would ask into a window nobody has open, and wait out the silence it finds.
     */
    test('asks under the id of the loop that handed the task over', async () => {
        const {loop, handler} = newLoop();
        assignedTo('a2');
        const taskLoop = await loop.newTestTaskLoop();
        await taskLoop.sealedHandler().onInteractionEvent(
            {type: 'input', content: 'which one?', browserId: 'b1'}
        );
        expect(handler.onInteractionEvent)
            .toHaveBeenCalledWith(expect.objectContaining({loopId: 'agent.a1'}));
    });

    test('leaves a task nobody owns on the model of the loop handing it over', async () => {
        const {loop} = newLoop();
        const taskLoop = await loop.newTestTaskLoop();
        expect(mocks.getSpawnedLoop).not.toHaveBeenCalled();
        expect(TestLoop.spawnedLoops).toEqual([taskLoop]);
    });

    /** Nothing to pick where the assignee is the one handing it over, so nothing is asked. */
    test('takes the short way for a task the agent kept for itself', async () => {
        const {loop} = newLoop();
        assignedTo('a1', 'Ada');
        const taskLoop = await loop.newTestTaskLoop();
        expect(mocks.getSpawnedLoop).not.toHaveBeenCalled();
        expect(TestLoop.spawnedLoops).toEqual([taskLoop]);
    });

    /**
     * Whoever reads the answer picked the assignee. A task quietly worked by a model they did not
     * choose is worse than one refused, and the loop asking has somewhere to go with a refusal.
     *
     * All of it is read back, not the half naming the agent. What is read is read by a model, and
     * a cause running straight on into the advice reads as one sentence saying neither.
     */
    test('refuses a task rather than work it on a model nobody chose', async () => {
        const {loop} = newLoop();
        assignedTo('a2');
        mocks.getSpawnedLoop.mockImplementation(() => {
            throw new Error('Invalid agent baseURL: not a url');
        });
        await expect(loop.newTestTaskLoop()).rejects.toThrow(
            'This task belongs to "a2", and no run can be built for that agent '
            + '(Invalid agent baseURL: not a url). '
            + 'Hand the task to somebody else, or have the user look at that agent.'
        );
    });

    /**
     * A name the board still holds and the configuration no longer does. Read as "then the task is
     * nobody's", it would take the short way and run on the model of the loop handing it over --
     * quietly, which is the one thing the refusal is here to prevent. So the id is carried as the
     * board has it and refused by name.
     */
    test('refuses a task left with an agent that was deleted', async () => {
        const {loop} = newLoop();
        mocks.taskAssigneeId.mockReturnValue('ghost');
        mocks.taskAssignee.mockReturnValue(undefined);
        mocks.getSpawnedLoop.mockImplementation(() => {
            throw new Error('Agent "ghost" not found');
        });
        await expect(loop.newTestTaskLoop()).rejects.toThrow('This task belongs to "ghost"');
        expect(TestLoop.spawnedLoops).toEqual([]);
    });

    /** Whatever it ends its own message with, the advice after it still starts a sentence. */
    test('holds the cause of a refusal apart from what to do about it', async () => {
        const {loop} = newLoop();
        assignedTo('a2');
        mocks.getSpawnedLoop.mockImplementation(() => {
            throw new Error('Agent doesn\'t exit!');
        });
        await expect(loop.newTestTaskLoop()).rejects.toThrow(
            'for that agent (Agent doesn\'t exit!). Hand the task'
        );
    });

    /** A worker is a worker whatever its owner set it to: chat mode has none of the tools. */
    test('works a task in agent mode even for an assignee kept in chat mode', async () => {
        const {loop} = newLoop();
        assignedTo('a2');
        mocks.loadAgentConfig.mockReturnValue(newTestAgentConfig({id: 'a2', mode: 'chat'}));
        const taskLoop = await loop.newTestTaskLoop();
        taskLoop.fakeLLM().responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('tu1')]},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        await taskLoop.runInvoke('go', {browserId: 'b1'});
        expect(contextOfFirstTool().loopConfig.mode).toBe('agent');
    });

    /** A helper of a run is that run: it works with the model the run was handed over to. */
    test('hands the model of a task down to the helpers of that run', () => {
        const {loop} = newLoop({
            spawned: {...newSpawned('task', {projectId: 'p1', taskId: 'ship-it'}), runAs: 'a2'}
        });
        loop.newTestSubLoop();
        expect(mocks.getSessionDir).toHaveBeenLastCalledWith('agent', 'a1', '', expect.objectContaining({
            kind: 'sub', runAs: 'a2',
        }));
    });

    /** Whoever spawned the loop reads the pictures off it, the answer of a loop may not carry them. */
    test('names the pictures that were drawn during the run', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('tu1'), toolUse('tu2')]},
            {transitionReason: 'endLoop', text: 'drawn'},
        ];
        mocks.executeToolCall.mockImplementation(async (def, context) => {
            const actions = (context as OneLoopContext).actions;
            actions.addFootPrint({type: 'image', content: `dcimg://agent.a1/${def.id}.png`});
            actions.addFootPrint({type: 'toolUse', content: def.name});
            return {result: {id: def.id, content: 'done'}, success: true};
        });
        await loop.runInvoke('draw two', {browserId: 'b1'});
        expect(loop.getDrawnImages())
            .toEqual(['dcimg://agent.a1/tu1.png', 'dcimg://agent.a1/tu2.png']);
    });

    test('has no pictures to hand over when none were drawn', () => {
        expect(newLoop().loop.getDrawnImages()).toEqual([]);
    });

    /** The same prompt drawn twice lands on the same bytes, and one reference is enough. */
    test('names a picture once even when it was drawn again', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('tu1'), toolUse('tu2')]},
            {transitionReason: 'endLoop', text: 'drawn'},
        ];
        mocks.executeToolCall.mockImplementation(async (def, context) => {
            (context as OneLoopContext).actions
                .addFootPrint({type: 'image', content: 'dcimg://agent.a1/same.png'});
            return {result: {id: def.id, content: 'done'}, success: true};
        });
        await loop.runInvoke('draw it twice', {browserId: 'b1'});
        expect(loop.getDrawnImages()).toEqual(['dcimg://agent.a1/same.png']);
    });

    /** A trace shared with the siblings would report the pictures of one of them over and over. */
    test('keeps the pictures of a sub loop to itself', async () => {
        const {loop} = newLoop();
        mocks.executeToolCall.mockImplementation(async (def, context) => {
            (context as OneLoopContext).actions
                .addFootPrint({type: 'image', content: `dcimg://agent.a1/${def.name}.png`});
            return {result: {id: def.id, content: 'drawn'}, success: true};
        });
        const first = loop.newTestSubLoop();
        first.fakeLLM().responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('tu1', 'first')]},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        await first.runInvoke('draw one', {browserId: 'b1'});
        const second = loop.newTestSubLoop();
        second.fakeLLM().responses = [
            {transitionReason: 'toolUse', toolUses: [toolUse('tu2', 'second')]},
            {transitionReason: 'endLoop', text: 'done'},
        ];
        await second.runInvoke('draw another', {browserId: 'b1'});

        expect(first.getDrawnImages()).toEqual(['dcimg://agent.a1/first.png']);
        expect(second.getDrawnImages()).toEqual(['dcimg://agent.a1/second.png']);
        expect(loop.getDrawnImages()).toEqual([]);
    });
});
