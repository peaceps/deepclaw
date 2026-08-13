import {beforeEach, describe, expect, test, vi} from 'vitest';
import {
    BREAK_POINTS,
    type AgentHandler, type AgentInvokeOptions, type AgentRuntime, type ImageContent,
    type FlushAgentRole, type LLMTransitionReason, type SealedAgentHandler, type TokenUsage
} from '@deepclaw/core';
import {type AgentConfig, type AgentMode} from '@deepclaw/config';
import {type Logger} from '@deepclaw/node-utils';
import {type LLMProtocol, type OneLoopContext, type SystemPrompt} from '../../definitions/definitions';
import {type ToolUseDef, type ToolUseResult} from '../../definitions/tool-definitions';
import {type LLMConstructor, type LLMModel} from '../../llm/llmgw';
import {newTestAgentConfig, newTestRuntime} from '../../../test-support/one-loop-context';
import {LoopAgent} from './loop';

const mocks = vi.hoisted(() => ({
    loadAgentConfig: vi.fn<(agentId: string) => unknown>(),
    getSessionDir: vi.fn<(...args: unknown[]) => string>(() => '.agents/a1/session/s1'),
    loadSession: vi.fn<(...args: unknown[]) => unknown>(() => ({history: [], outdated: false})),
    updateSessionRuntime: vi.fn(),
    saveHistory: vi.fn(),
    provideSystemPrompt: vi.fn<(...args: unknown[]) => unknown>(
        () => ({cacheable: 'cacheable', dynamic: 'dynamic'})
    ),
    getAgent: vi.fn<(agentId: string) => unknown>(() => ({id: 'a1', name: 'Ada'})),
    emitVisitor: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
    emitInterceptor: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({result: 'continue'})),
    executeToolCall: vi.fn<(toolUseDef: ToolUseDef, context: unknown) => Promise<unknown>>(),
    planExecutionGroups: vi.fn<(toolUseDefs: ToolUseDef[], context: unknown) => ToolUseDef[][]>(),
    compactOldResults: vi.fn(),
    compactFullHistory: vi.fn(async () => undefined),
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
    },
}));

vi.mock('../services/prompt-service', () => ({
    PromptService: {provideSystemPrompt: mocks.provideSystemPrompt},
}));

vi.mock('../services/agent-identity-manager', () => ({
    AgentIdentityManager: {getAgent: mocks.getAgent},
}));

vi.mock('../services/hook-manager', () => ({
    HookManager: {emitVisitor: mocks.emitVisitor, emitInterceptor: mocks.emitInterceptor},
}));

vi.mock('../services/tool-use-service', () => ({
    ToolUseService: {
        executeToolCall: mocks.executeToolCall,
        planExecutionGroups: mocks.planExecutionGroups,
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

type TestMessage = {role: 'user' | 'assistant' | 'tool', text: string};
type TestResponse = {
    transitionReason: LLMTransitionReason;
    text?: string;
    toolUses?: ToolUseDef[];
};

class FakeLLM {
    public static instances: FakeLLM[] = [];
    public readonly isSubLoop: boolean;
    public readonly llmConfig: unknown;
    public responses: TestResponse[] = [];
    public usage: TokenUsage = {cachedInputTokens: 1, noCachedInputTokens: 2, outputTokens: 3};
    public updateGWConfig = vi.fn();

    public invoke = vi.fn<(
        mode: AgentMode, system: SystemPrompt, messages: TestMessage[],
        onText: (text: string) => void, logger: Logger
    ) => Promise<TestResponse>>(async (...args) => {
        const [, , messages, onText] = args;
        const response = this.responses.shift() ?? {transitionReason: 'endLoop' as LLMTransitionReason};
        onText(response.text ?? '');
        messages.push({role: 'assistant', text: response.text ?? ''});
        return response;
    });

    constructor(isSubLoop: boolean, llmConfig: unknown) {
        this.isSubLoop = isSubLoop;
        this.llmConfig = llmConfig;
        FakeLLM.instances.push(this);
    }

    public getTokenUsage(): TokenUsage {
        return this.usage;
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
    public static subLoops: TestLoop[] = [];

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
        return toolResults.map(result => ({role: 'tool', text: result.content}));
    }

    protected override newSubLoop(
        role: FlushAgentRole, agentId: string, projectId: string,
        subLoopAgentHandler: AgentHandler, subLoopId: string
    ): TestLoop {
        const subLoop = new TestLoop(role, agentId, projectId, subLoopAgentHandler, subLoopId);
        TestLoop.subLoops.push(subLoop);
        return subLoop;
    }

    public fakeLLM(): FakeLLM {
        return this.llm as unknown as FakeLLM;
    }

    public sealedHandler(): SealedAgentHandler {
        return this.agentHandler;
    }

    public runInvoke(input: string, options: AgentInvokeOptions): Promise<{text: string, runtime: AgentRuntime}> {
        return this._invoke(input, options);
    }

    public runResume(options: AgentInvokeOptions & {runtime: AgentRuntime}) {
        return this._resume(options);
    }

    public newTestSubLoop(): TestLoop {
        return this.createSubLoop() as TestLoop;
    }
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
    handler?: AgentHandler, subLoopId?: string
} = {}) {
    const handler = options.handler ?? newHandler();
    mocks.loadAgentConfig.mockReturnValue(options.config ?? newTestAgentConfig());
    mocks.loadSession.mockReturnValue({history: options.history ?? [], outdated: options.outdated ?? false});
    const loop = new TestLoop(options.role ?? 'agent', 'a1', '', handler, options.subLoopId);
    return {loop, handler, llm: loop.fakeLLM()};
}

/** The history array the loop persisted on its last save. */
function savedHistory(): TestMessage[] {
    return mocks.saveHistory.mock.calls.at(-1)![0] as TestMessage[];
}

function toolUse(id: string, name = 'demo'): ToolUseDef {
    return {id, name, input: {}};
}

beforeEach(() => {
    vi.clearAllMocks();
    FakeLLM.instances = [];
    TestLoop.subLoops = [];
    mocks.getSessionDir.mockReturnValue('.agents/a1/session/s1');
    mocks.loadSession.mockReturnValue({history: [], outdated: false});
    mocks.provideSystemPrompt.mockReturnValue({cacheable: 'cacheable', dynamic: 'dynamic'});
    mocks.getAgent.mockReturnValue({id: 'a1', name: 'Ada'});
    mocks.emitVisitor.mockResolvedValue(undefined);
    mocks.emitInterceptor.mockResolvedValue({result: 'continue'});
    mocks.executeToolCall.mockImplementation(async (def) => ({
        result: {id: def.id, content: `${def.name} done`}, success: true
    }));
    mocks.planExecutionGroups.mockImplementation(defs => defs.map(def => [def]));
});

describe('construction', () => {

    test('builds its llm with the agent llm config and the loop kind', () => {
        const config = newTestAgentConfig({llm: {baseURL: 'https://api.openai.com', apiKey: 'k', model: 'm'}});
        const {llm} = newLoop({config});
        expect(llm.isSubLoop).toBe(false);
        expect(llm.llmConfig).toEqual({baseURL: 'https://api.openai.com', apiKey: 'k', model: 'm'});
    });

    test('marks a loop with a sub loop id as a sub loop', () => {
        const {llm} = newLoop({subLoopId: 'sub1'});
        expect(llm.isSubLoop).toBe(true);
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
        const {loop} = newLoop({subLoopId: 'sub1'});
        expect(mocks.getSessionDir).toHaveBeenCalledWith('agent', 'a1', '', 'sub1');
        expect(loop.getSessionDir()).toBe('.agents/a1/session/s1');
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
            expect.objectContaining({id: 'a1'}), {id: 'a1', name: 'Ada'}, 'agent', '', false, undefined
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

    test('keeps the pending tools in a break point when the user walked away', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{transitionReason: 'toolUse', toolUses: [toolUse('tu1'), toolUse('tu2')]}];
        mocks.executeToolCall.mockImplementationOnce(async (def, context) => {
            (context as {runtime: AgentRuntime}).runtime.agentBreakReason = 'interactionAfk';
            return {result: {id: def.id, content: 'needs the user'}, success: false, rerun: true};
        });
        const {runtime} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(runtime.breakPoint.point).toBe(BREAK_POINTS.toolUse);
        expect(runtime.breakPoint.input).toEqual([toolUse('tu1'), toolUse('tu2')]);
        expect(mocks.executeToolCall).toHaveBeenCalledOnce();
    });

    test('drops the token usage of a turn that has to be replayed', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{transitionReason: 'toolUse', toolUses: [toolUse('tu1')]}];
        mocks.executeToolCall.mockImplementationOnce(async (def, context) => {
            (context as {runtime: AgentRuntime}).runtime.agentBreakReason = 'interactionAfk';
            return {result: {id: def.id, content: 'needs the user'}, success: false, rerun: true};
        });
        const {runtime} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(runtime.usage).toEqual({cachedInputTokens: 0, noCachedInputTokens: 0, outputTokens: 0});
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

    test('keeps the results of the siblings of a tool call the user has to answer for', async () => {
        const {loop, llm} = newLoop();
        llm.responses = [{
            transitionReason: 'toolUse',
            toolUses: [toolUse('tu1'), toolUse('tu2'), toolUse('tu3')],
        }];
        mocks.planExecutionGroups.mockImplementation(defs => [defs.slice(0, 2), defs.slice(2)]);
        mocks.executeToolCall.mockImplementation(async (def, context) => {
            if (def.id !== 'tu1') {
                return {result: {id: def.id, content: `${def.id} done`}, success: true};
            }
            (context as {runtime: AgentRuntime}).runtime.agentBreakReason = 'interactionAfk';
            return {result: {id: def.id, content: 'needs the user'}, success: false, rerun: true};
        });
        const {runtime} = await loop.runInvoke('hi', {browserId: 'b1'});
        expect(runtime.breakPoint.input).toEqual([toolUse('tu1'), toolUse('tu3')]);
        expect(savedHistory().filter(message => message.role === 'tool').map(message => message.text))
            .toEqual(['tu2 done']);
    });
});

describe('resume', () => {

    test('picks the pending tools up from the break point without asking the llm again', async () => {
        const {loop, llm} = newLoop();
        const runtime = newTestRuntime({
            transitionReason: 'toolUse',
            breakPoint: {point: BREAK_POINTS.toolUse, input: [toolUse('tu2')]},
        });
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runResume({browserId: 'b1', runtime});
        expect(mocks.executeToolCall).toHaveBeenCalledExactlyOnceWith(toolUse('tu2'), expect.anything());
    });

    test('does not add the input again on a resume', async () => {
        const {loop, llm} = newLoop({history: [{role: 'user', text: 'earlier'}]});
        llm.responses = [{transitionReason: 'endLoop', text: 'done'}];
        await loop.runResume({browserId: 'b1', runtime: newTestRuntime()});
        expect(savedHistory().map(message => message.text)).toEqual(['earlier', 'done']);
    });

    test('stops right away when the turn limit was already reached', async () => {
        const {loop, handler} = newLoop();
        const {text} = await loop.runResume({
            browserId: 'b1', runtime: newTestRuntime({turnCount: 100})
        });
        expect(text).toContain('agent.maxTurnReached');
        expect(handler.onStreamText).toHaveBeenCalledWith(expect.objectContaining({browserId: 'b1'}));
        expect(loop.fakeLLM().invoke).not.toHaveBeenCalled();
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
        expect(runtime.recoveryState.maxTokenRetries).toBe(1);
        expect(savedHistory().some(message => message.text.includes('Output limit hit'))).toBe(true);
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

describe('sub loops', () => {

    test('creates a sub loop that shares the ids but has its own session', () => {
        const {loop} = newLoop();
        const subLoop = loop.newTestSubLoop();
        expect(TestLoop.subLoops).toEqual([subLoop]);
        expect(subLoop.fakeLLM().isSubLoop).toBe(true);
    });

    test('keeps the stream of a sub loop private', async () => {
        const {loop, handler} = newLoop();
        const subLoop = loop.newTestSubLoop();
        subLoop.fakeLLM().responses = [{transitionReason: 'endLoop', text: 'sub answer'}];
        await subLoop.runInvoke('sub task', {browserId: 'b1'});
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

    test('refuses to nest another sub loop', () => {
        const {loop} = newLoop({subLoopId: 'sub1'});
        expect(() => loop.createSubLoop()).toThrow('Sub-loop cannot create a sub-loop');
    });

    test('builds the prompt of a task sub loop around its task', async () => {
        const {loop} = newLoop();
        const subLoop = loop.createSubLoop({projectId: 'p1', taskTitle: 'ship it'}) as TestLoop;
        subLoop.fakeLLM().responses = [{transitionReason: 'endLoop', text: 'done'}];
        await subLoop.runInvoke('go', {browserId: 'b1'});
        expect(mocks.provideSystemPrompt).toHaveBeenLastCalledWith(
            expect.anything(), expect.anything(), 'agent', '', true,
            {projectId: 'p1', taskTitle: 'ship it'}
        );
    });

    test('leaves the prompt of a sub loop without a task alone', async () => {
        const {loop} = newLoop();
        const subLoop = loop.newTestSubLoop();
        subLoop.fakeLLM().responses = [{transitionReason: 'endLoop', text: 'done'}];
        await subLoop.runInvoke('go', {browserId: 'b1'});
        expect(mocks.provideSystemPrompt).toHaveBeenLastCalledWith(
            expect.anything(), expect.anything(), 'agent', '', true, undefined
        );
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
