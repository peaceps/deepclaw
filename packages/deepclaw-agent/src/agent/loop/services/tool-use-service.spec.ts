import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type ToolDesc, type ToolGuardResult, type ToolUseDef} from '../../definitions/tool-definitions';
import {newTestContext} from '../../../test-support/one-loop-context';
import {ToolUseService} from './tool-use-service';

const mocks = vi.hoisted(() => ({
    getToolDesc: vi.fn<(run: unknown, name: string) => unknown>(),
    emitVisitor: vi.fn(),
    wrapTimestamp: vi.fn((file: string) => `stamped-${file}`),
    writeFile: vi.fn((path: string) => path),
}));

vi.mock('./tools-manager', () => ({ToolsManager: {getToolDesc: mocks.getToolDesc}}));
vi.mock('./hook-manager', () => ({HookManager: {emitVisitor: mocks.emitVisitor}}));
vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {wrapTimestamp: mocks.wrapTimestamp, writeFile: mocks.writeFile},
}));

function newTool(overrides: Partial<ToolDesc<unknown>> = {}): ToolDesc<unknown> {
    return {
        tool: {name: 'demo', description: 'demo tool', schema: {type: 'object'}},
        parallelSafe: true,
        agentMode: ['agent'],
        invoke: vi.fn(async () => 'tool output'),
        ...overrides,
    };
}

function newToolUse(overrides: Partial<ToolUseDef> = {}): ToolUseDef {
    return {id: 'tu1', name: 'demo', input: {value: 1}, ...overrides};
}

/** A loop found unattended stays that way until told otherwise, so each test starts fresh. */
function forgetAwayUsers(): void {
    ToolUseService.clearAwayUser('agent.a1');
    ToolUseService.clearAwayUser('agent.a2');
}

describe('executeToolCall lookup', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('fails when the tool is unknown to the manager', async () => {
        mocks.getToolDesc.mockReturnValue(undefined);
        const result = await ToolUseService.executeToolCall(newToolUse({name: 'ghost'}), newTestContext());
        expect(result).toEqual({result: {id: 'tu1', content: 'Unknown tool: ghost'}, success: false});
    });

    test('looks the tool up for the run it is called in', async () => {
        mocks.getToolDesc.mockReturnValue(newTool());
        const context = newTestContext({loopKind: 'sub', role: 'cron'});
        context.loopConfig.mode = 'chat';
        await ToolUseService.executeToolCall(newToolUse(), context);
        expect(mocks.getToolDesc).toHaveBeenCalledWith(
            {loopKind: 'sub', role: 'cron', mode: 'chat'}, 'demo'
        );
    });
});

describe('executeToolCall input', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('parses a json string input before invoking', async () => {
        const tool = newTool();
        mocks.getToolDesc.mockReturnValue(tool);
        const context = newTestContext();
        await ToolUseService.executeToolCall(newToolUse({input: '{"value":2}'}), context);
        expect(tool.invoke).toHaveBeenCalledWith({value: 2}, context);
    });

    test('passes an object input straight through', async () => {
        const tool = newTool();
        mocks.getToolDesc.mockReturnValue(tool);
        await ToolUseService.executeToolCall(newToolUse({input: {value: 3}}), newTestContext());
        expect(tool.invoke).toHaveBeenCalledWith({value: 3}, expect.anything());
    });

    test('treats a missing input as an empty object', async () => {
        const tool = newTool();
        mocks.getToolDesc.mockReturnValue(tool);
        await ToolUseService.executeToolCall(newToolUse({input: undefined}), newTestContext());
        expect(tool.invoke).toHaveBeenCalledWith({}, expect.anything());
    });

    test('fails on an input that is not valid json', async () => {
        const tool = newTool();
        mocks.getToolDesc.mockReturnValue(tool);
        const {result, success} = await ToolUseService.executeToolCall(
            newToolUse({input: '{value: '}), newTestContext()
        );
        expect(success).toBe(false);
        expect(result.content).toContain('Parse input to JSON failed');
        expect(tool.invoke).not.toHaveBeenCalled();
    });
});

describe('executeToolCall guard', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        forgetAwayUsers();
    });

    test('skips a denied tool and reports it to the hooks', async () => {
        const tool = newTool({guard: () => ({result: 'denied', reason: 'outside workspace'})});
        mocks.getToolDesc.mockReturnValue(tool);
        const context = newTestContext();
        const {result, success} = await ToolUseService.executeToolCall(newToolUse(), context);
        expect(success).toBe(false);
        expect(result.content).toBe('Tool run is not allowed: demo. outside workspace.');
        expect(mocks.emitVisitor).toHaveBeenCalledWith('toolGuardDenied', context, {
            toolUseDef: newToolUse(), reason: 'outside workspace'
        });
        expect(tool.invoke).not.toHaveBeenCalled();
    });

    test('asks the user and runs the tool once the answer is accepted', async () => {
        const tool = newTool({guard: () => ({
            result: 'ask',
            question: {type: 'input', content: 'may I?'},
            checkAnswer: answer => answer === 'yes',
        })});
        mocks.getToolDesc.mockReturnValue(tool);
        const context = newTestContext();
        vi.mocked(context.actions.agentHandler.onInteractionEvent).mockResolvedValue('yes');
        const {success} = await ToolUseService.executeToolCall(newToolUse(), context);
        expect(context.actions.agentHandler.onInteractionEvent)
            .toHaveBeenCalledWith({type: 'input', content: 'may I?', browserId: 'b1'});
        expect(success).toBe(true);
        expect(tool.invoke).toHaveBeenCalled();
    });

    test('stops when the user rejects the question', async () => {
        const tool = newTool({guard: () => ({
            result: 'ask',
            question: {type: 'input', content: 'may I?'},
            checkAnswer: () => false,
        })});
        mocks.getToolDesc.mockReturnValue(tool);
        const {result, success} = await ToolUseService.executeToolCall(newToolUse(), newTestContext());
        expect(success).toBe(false);
        expect(result.content).toBe('Execution of tool demo is rejected by user.');
        expect(tool.invoke).not.toHaveBeenCalled();
    });

    /** The run goes on without the permission: it is the tool call that failed, not the loop. */
    test('fails the tool call when nobody answered the question', async () => {
        const tool = newTool({guard: () => ({
            result: 'ask',
            question: {type: 'input', content: 'may I?'},
            checkAnswer: () => true,
        })});
        mocks.getToolDesc.mockReturnValue(tool);
        const context = newTestContext();
        vi.mocked(context.actions.agentHandler.onInteractionEvent).mockRejectedValue('interactionAfk');
        const {result, success} = await ToolUseService.executeToolCall(newToolUse(), context);
        expect(success).toBe(false);
        expect(context.runtime.agentBreakReason).toBeUndefined();
        expect(result.content).toContain('Nobody answered the permission question');
        expect(tool.invoke).not.toHaveBeenCalled();
    });

    /** What a run with no browser behind it is told, its question having nobody to reach. */
    test('fails the tool call when there was nobody to ask at all', async () => {
        const tool = newTool({guard: () => ({
            result: 'ask',
            question: {type: 'input', content: 'may I?'},
            checkAnswer: () => true,
        })});
        mocks.getToolDesc.mockReturnValue(tool);
        const context = newTestContext({browserId: ''});
        vi.mocked(context.actions.agentHandler.onInteractionEvent).mockRejectedValue('disconnected');
        const {result, success} = await ToolUseService.executeToolCall(newToolUse(), context);
        expect(success).toBe(false);
        expect(result.content).toBe('There is nobody to ask for the permission to run demo, so it was not run.');
        expect(tool.invoke).not.toHaveBeenCalled();
    });

    test('reports any other failure while waiting for the user', async () => {
        const tool = newTool({guard: () => ({
            result: 'ask',
            question: {type: 'input', content: 'may I?'},
            checkAnswer: () => true,
        })});
        mocks.getToolDesc.mockReturnValue(tool);
        const context = newTestContext();
        vi.mocked(context.actions.agentHandler.onInteractionEvent).mockRejectedValue(new Error('socket died'));
        const {result, success} = await ToolUseService.executeToolCall(newToolUse(), context);
        expect(success).toBe(false);
        expect(result.content).toContain('wait for user response failed');
        expect(context.runtime.agentBreakReason).toBeUndefined();
    });

    /**
     * A subagent asks the same as anybody else: the question travels under the loop id it shares
     * with whoever spawned it, so it reaches the same page and the same answer counts for the tree.
     */
    test('asks the user for a tool of a spawned loop as well', async () => {
        const tool = newTool({guard: () => ({
            result: 'ask',
            question: {type: 'input', content: 'may I?'},
            checkAnswer: () => false,
        })});
        mocks.getToolDesc.mockReturnValue(tool);
        const context = newTestContext({loopKind: 'sub'});
        const {result, success} = await ToolUseService.executeToolCall(newToolUse(), context);
        expect(context.actions.agentHandler.onInteractionEvent)
            .toHaveBeenCalledWith({type: 'input', content: 'may I?', browserId: 'b1'});
        expect(success).toBe(false);
        expect(result.content).toBe('Execution of tool demo is rejected by user.');
        expect(tool.invoke).not.toHaveBeenCalled();
    });

    test('still denies a sub loop tool that the guard refused outright', async () => {
        const tool = newTool({guard: () => ({result: 'denied', reason: 'outside workspace'})});
        mocks.getToolDesc.mockReturnValue(tool);
        const {success} = await ToolUseService.executeToolCall(
            newToolUse(), newTestContext({loopKind: 'sub'})
        );
        expect(success).toBe(false);
        expect(tool.invoke).not.toHaveBeenCalled();
    });

    /**
     * Whoever set the schedule up granted the permission then: they are not there at three in the
     * morning to grant it again, and a run that asks anyway gets nothing done.
     */
    test('grants a cron run what the guard would have asked about', async () => {
        const tool = newTool({guard: () => ({
            result: 'ask',
            question: {type: 'input', content: 'may I?'},
            checkAnswer: () => false,
        })});
        mocks.getToolDesc.mockReturnValue(tool);
        const context = newTestContext({role: 'cron'});
        const {success} = await ToolUseService.executeToolCall(newToolUse(), context);
        expect(success).toBe(true);
        expect(context.actions.agentHandler.onInteractionEvent).not.toHaveBeenCalled();
        expect(tool.invoke).toHaveBeenCalled();
    });

    test('still denies a cron run what the guard refused outright', async () => {
        const tool = newTool({guard: () => ({result: 'denied', reason: 'outside workspace'})});
        mocks.getToolDesc.mockReturnValue(tool);
        const {result, success} = await ToolUseService.executeToolCall(
            newToolUse(), newTestContext({role: 'cron'})
        );
        expect(success).toBe(false);
        expect(result.content).toBe('Tool run is not allowed: demo. outside workspace.');
        expect(tool.invoke).not.toHaveBeenCalled();
    });

    test('runs a tool whose guard allows it right away', async () => {
        const tool = newTool({guard: () => ({result: 'allowed'})});
        mocks.getToolDesc.mockReturnValue(tool);
        const context = newTestContext();
        const {success} = await ToolUseService.executeToolCall(newToolUse(), context);
        expect(success).toBe(true);
        expect(context.actions.agentHandler.onInteractionEvent).not.toHaveBeenCalled();
    });
});

/** Lets every pending promise callback run. */
function flush(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function newAskingTool(guardResults: ToolGuardResult[]): ToolDesc<unknown> {
    const ask: ToolGuardResult = {
        result: 'ask',
        question: {type: 'input', content: 'may I?'},
        checkAnswer: () => true,
    };
    return newTool({guard: () => guardResults.shift() ?? ask});
}

describe('executeToolCall question queue', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        forgetAwayUsers();
    });

    test('asks the questions of one loop one after the other', async () => {
        mocks.getToolDesc.mockReturnValue(newAskingTool([]));
        const context = newTestContext();
        const answers: ((answer: string) => void)[] = [];
        vi.mocked(context.actions.agentHandler.onInteractionEvent)
            .mockImplementation(() => new Promise<string>(resolve => answers.push(resolve)));

        const first = ToolUseService.executeToolCall(newToolUse(), context);
        const second = ToolUseService.executeToolCall(newToolUse({id: 'tu2'}), context);
        await flush();
        expect(answers).toHaveLength(1);

        answers[0]!('yes');
        await first;
        await flush();
        expect(answers).toHaveLength(2);

        answers[1]!('yes');
        expect((await second).success).toBe(true);
    });

    test('lets another loop ask at the same time', async () => {
        mocks.getToolDesc.mockReturnValue(newAskingTool([]));
        const context = newTestContext();
        const other = newTestContext({loopId: 'agent.a2'});
        const answers: ((answer: string) => void)[] = [];
        const pending = () => new Promise<string>(resolve => answers.push(resolve));
        vi.mocked(context.actions.agentHandler.onInteractionEvent).mockImplementation(pending);
        vi.mocked(other.actions.agentHandler.onInteractionEvent).mockImplementation(pending);

        const first = ToolUseService.executeToolCall(newToolUse(), context);
        const second = ToolUseService.executeToolCall(newToolUse({id: 'tu2'}), other);
        await flush();
        expect(answers).toHaveLength(2);

        answers.forEach(answer => answer('yes'));
        expect((await first).success).toBe(true);
        expect((await second).success).toBe(true);
    });

    /**
     * The queue is what makes this worth remembering: the questions behind an unanswered one would
     * each wait their own ten minutes for the silence the first one already found.
     */
    test('stops asking once a question went unanswered', async () => {
        mocks.getToolDesc.mockReturnValue(newAskingTool([]));
        const context = newTestContext();
        vi.mocked(context.actions.agentHandler.onInteractionEvent).mockRejectedValue('interactionAfk');

        const first = ToolUseService.executeToolCall(newToolUse(), context);
        const second = ToolUseService.executeToolCall(newToolUse({id: 'tu2'}), context);
        expect((await first).success).toBe(false);
        const {result, success} = await second;
        expect(success).toBe(false);
        expect(result.content).toContain('Nobody answered the permission question');
        expect(context.actions.agentHandler.onInteractionEvent).toHaveBeenCalledOnce();
    });

    test('keeps asking the loops the silence was not on', async () => {
        mocks.getToolDesc.mockReturnValue(newAskingTool([]));
        const away = newTestContext();
        const other = newTestContext({loopId: 'agent.a2'});
        vi.mocked(away.actions.agentHandler.onInteractionEvent).mockRejectedValue('interactionAfk');
        vi.mocked(other.actions.agentHandler.onInteractionEvent).mockResolvedValue('yes');

        expect((await ToolUseService.executeToolCall(newToolUse(), away)).success).toBe(false);
        expect((await ToolUseService.executeToolCall(newToolUse(), other)).success).toBe(true);
    });

    test('asks again once a run is asked for anew', async () => {
        mocks.getToolDesc.mockReturnValue(newAskingTool([]));
        const context = newTestContext();
        vi.mocked(context.actions.agentHandler.onInteractionEvent)
            .mockRejectedValueOnce('interactionAfk').mockResolvedValueOnce('yes');

        expect((await ToolUseService.executeToolCall(newToolUse(), context)).success).toBe(false);
        ToolUseService.clearAwayUser(context.loopId);
        expect((await ToolUseService.executeToolCall(newToolUse({id: 'tu2'}), context)).success).toBe(true);
        expect(context.actions.agentHandler.onInteractionEvent).toHaveBeenCalledTimes(2);
    });

    test('keeps asking while the user is only slow to answer', async () => {
        mocks.getToolDesc.mockReturnValue(newAskingTool([]));
        const context = newTestContext();
        vi.mocked(context.actions.agentHandler.onInteractionEvent).mockResolvedValue('yes');

        const first = ToolUseService.executeToolCall(newToolUse(), context);
        const second = ToolUseService.executeToolCall(newToolUse({id: 'tu2'}), context);
        expect((await first).success).toBe(true);
        expect((await second).success).toBe(true);
        expect(context.actions.agentHandler.onInteractionEvent).toHaveBeenCalledTimes(2);
    });

    test('denies the tool when the guard withdrew the permission before the question was asked', async () => {
        const tool = newAskingTool([
            {result: 'ask', question: {type: 'input', content: 'may I?'}, checkAnswer: () => true},
            {result: 'denied', reason: 'the file left the workspace'},
        ]);
        mocks.getToolDesc.mockReturnValue(tool);
        const context = newTestContext();
        const {result, success} = await ToolUseService.executeToolCall(newToolUse(), context);
        expect(success).toBe(false);
        expect(result.content).toBe('Tool run is not allowed: demo. the file left the workspace.');
        expect(context.actions.agentHandler.onInteractionEvent).not.toHaveBeenCalled();
        expect(tool.invoke).not.toHaveBeenCalled();
        expect(mocks.emitVisitor).toHaveBeenCalledWith('toolGuardDenied', context, {
            toolUseDef: newToolUse(),
            reason: 'the file left the workspace',
        });
    });

    test('drops the question when the guard allows the tool by the time it is asked', async () => {
        const tool = newAskingTool([
            {result: 'ask', question: {type: 'input', content: 'may I?'}, checkAnswer: () => true},
            {result: 'allowed'},
        ]);
        mocks.getToolDesc.mockReturnValue(tool);
        const context = newTestContext();
        vi.mocked(context.actions.agentHandler.onInteractionEvent).mockResolvedValue('yes');
        const {success} = await ToolUseService.executeToolCall(newToolUse(), context);
        expect(success).toBe(true);
        expect(context.actions.agentHandler.onInteractionEvent).not.toHaveBeenCalled();
        expect(tool.invoke).toHaveBeenCalled();
    });
});

describe('askQuestion', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        forgetAwayUsers();
    });

    test('puts the question to the user of the loop and answers with what they said', async () => {
        const context = newTestContext();
        vi.mocked(context.actions.agentHandler.onInteractionEvent).mockResolvedValue('the second one');
        await expect(ToolUseService.askQuestion(
            {type: 'select', content: 'which one?', options: ['the first one', 'the second one']}, context
        )).resolves.toBe('the second one');
        expect(context.actions.agentHandler.onInteractionEvent).toHaveBeenCalledExactlyOnceWith({
            type: 'select', content: 'which one?', options: ['the first one', 'the second one'],
            browserId: 'b1',
        });
    });

    /** One user, one question at a time, whether a tool asks it or the guard in front of one does. */
    test('waits behind the permission question of the same loop', async () => {
        mocks.getToolDesc.mockReturnValue(newAskingTool([]));
        const context = newTestContext();
        const answers: ((answer: string) => void)[] = [];
        vi.mocked(context.actions.agentHandler.onInteractionEvent)
            .mockImplementation(() => new Promise<string>(resolve => answers.push(resolve)));

        const permission = ToolUseService.executeToolCall(newToolUse(), context);
        const question = ToolUseService.askQuestion({type: 'input', content: 'which one?'}, context);
        await flush();
        expect(answers).toHaveLength(1);

        answers[0]!('yes');
        await permission;
        await flush();
        expect(answers).toHaveLength(2);

        answers[1]!('the second one');
        await expect(question).resolves.toBe('the second one');
    });

    test('gives up at once on a loop whose user was already found away', async () => {
        const context = newTestContext();
        vi.mocked(context.actions.agentHandler.onInteractionEvent).mockRejectedValue('interactionAfk');

        await expect(ToolUseService.askQuestion({type: 'input', content: 'which one?'}, context))
            .rejects.toBe('interactionAfk');
        await expect(ToolUseService.askQuestion({type: 'input', content: 'and now?'}, context))
            .rejects.toBe('interactionAfk');
        expect(context.actions.agentHandler.onInteractionEvent).toHaveBeenCalledOnce();
    });

    /** Nobody to carry the question is not the same silence, and is worth asking again after. */
    test('passes on a question that never reached anybody', async () => {
        const context = newTestContext();
        vi.mocked(context.actions.agentHandler.onInteractionEvent)
            .mockRejectedValueOnce('disconnected').mockResolvedValueOnce('the first one');

        await expect(ToolUseService.askQuestion({type: 'input', content: 'which one?'}, context))
            .rejects.toBe('disconnected');
        await expect(ToolUseService.askQuestion({type: 'input', content: 'which one?'}, context))
            .resolves.toBe('the first one');
    });

    test('asks a loop again once its run is asked for anew', async () => {
        const context = newTestContext();
        vi.mocked(context.actions.agentHandler.onInteractionEvent)
            .mockRejectedValueOnce('interactionAfk').mockResolvedValueOnce('the first one');

        await expect(ToolUseService.askQuestion({type: 'input', content: 'which one?'}, context))
            .rejects.toBe('interactionAfk');
        ToolUseService.clearAwayUser(context.loopId);
        await expect(ToolUseService.askQuestion({type: 'input', content: 'which one?'}, context))
            .resolves.toBe('the first one');
    });
});

/**
 * What a tool call becomes when the run behind it is stopped. All three of these are legal results
 * whatever they say, so nothing here is about the protocol: it is about what the model is told
 * happened, since it acts on that next turn.
 */
describe('executeToolCall under a stop', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        forgetAwayUsers();
    });

    function stoppedContext() {
        const controller = new AbortController();
        controller.abort();
        return newTestContext({abortSignal: controller.signal});
    }

    /**
     * The abort surfaces as an ordinary throw out of the tool, and reported as one it reads as a
     * broken tool: the model tries it again next turn, or sets about explaining to the user a
     * fault that never happened.
     */
    test('tells the model a running tool was stopped rather than that it failed', async () => {
        mocks.getToolDesc.mockReturnValue(newTool({
            invoke: vi.fn(async () => {
                throw new Error('The operation was aborted');
            }),
        }));
        const {result} = await ToolUseService.executeToolCall(newToolUse(), stoppedContext());
        expect(result.content).toBe(
            'The user stopped this run while demo was running, so it did not finish.'
        );
        expect(result.content).not.toContain('aborted');
    });

    /**
     * The question is taken back by whoever stopped the run, and the reason it is taken back with
     * is neither of the two the guard knew before: read as a silence it would say nobody answered,
     * read as a missing browser it would say there was nobody to ask. The user was there.
     */
    test('tells the model a permission question was stopped, not unanswered', async () => {
        mocks.getToolDesc.mockReturnValue(newTool({guard: () => ({
            result: 'ask',
            question: {type: 'input', content: 'may I?'},
            checkAnswer: () => true,
        })}));
        const context = newTestContext();
        vi.mocked(context.actions.agentHandler.onInteractionEvent).mockRejectedValue('userStopped');
        const {result, success} = await ToolUseService.executeToolCall(newToolUse(), context);
        expect(success).toBe(false);
        expect(result.content).toBe(
            'The user stopped this run while demo was running, so it did not finish.'
        );
        expect(result.content).not.toContain('wait for user response failed');
    });

    /** A stop is not a silence, and the questions of the next run must not pay for it. */
    test('does not hold the user away over a question the stop took back', async () => {
        mocks.getToolDesc.mockReturnValue(newTool({guard: () => ({
            result: 'ask',
            question: {type: 'input', content: 'may I?'},
            checkAnswer: () => true,
        })}));
        const context = newTestContext();
        const ask = vi.mocked(context.actions.agentHandler.onInteractionEvent);
        ask.mockRejectedValueOnce('userStopped').mockResolvedValueOnce('yes');
        await ToolUseService.executeToolCall(newToolUse(), context);
        const {success} = await ToolUseService.executeToolCall(newToolUse({id: 'tu2'}), context);
        expect(success).toBe(true);
        expect(ask).toHaveBeenCalledTimes(2);
    });

    /**
     * Only the one question the run waits on is taken back by the gateway. The rest of the turn is
     * queued behind it, and each of those would open a dialog of its own for the user who just
     * pressed stop to watch appear and go.
     */
    test('puts no further question once the run was stopped', async () => {
        const context = stoppedContext();
        await expect(ToolUseService.askQuestion({type: 'input', content: 'which one?'}, context))
            .rejects.toBe('userStopped');
        expect(context.actions.agentHandler.onInteractionEvent).not.toHaveBeenCalled();
    });
});

describe('planExecutionGroups', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('puts parallel safe tool calls into a shared group', () => {
        mocks.getToolDesc.mockReturnValue(newTool());
        const defs = [newToolUse(), newToolUse({id: 'tu2'}), newToolUse({id: 'tu3'})];
        expect(ToolUseService.planExecutionGroups(defs, newTestContext())).toEqual([defs]);
    });

    test('gives a tool call that is not parallel safe a group of its own', () => {
        const safe = newTool();
        const exclusive = newTool({parallelSafe: false});
        mocks.getToolDesc.mockImplementation((_run, name) => name === 'lonely' ? exclusive : safe);
        const defs = [
            newToolUse(), newToolUse({id: 'tu2', name: 'lonely'}), newToolUse({id: 'tu3'}),
        ];
        expect(ToolUseService.planExecutionGroups(defs, newTestContext()))
            .toEqual([[defs[0]], [defs[1]], [defs[2]]]);
    });

    test('runs an unknown tool on its own', () => {
        mocks.getToolDesc.mockReturnValue(undefined);
        const defs = [newToolUse(), newToolUse({id: 'tu2'})];
        expect(ToolUseService.planExecutionGroups(defs, newTestContext()))
            .toEqual([[defs[0]], [defs[1]]]);
    });

    test('caps how many tool calls share a group', () => {
        mocks.getToolDesc.mockReturnValue(newTool());
        const defs = Array.from({length: 6}, (_unused, index) => newToolUse({id: `tu${index}`}));
        expect(ToolUseService.planExecutionGroups(defs, newTestContext()))
            .toEqual([defs.slice(0, 5), defs.slice(5)]);
    });

    test('holds a tool that asks for a narrower group to what it asked for', () => {
        mocks.getToolDesc.mockReturnValue(newTool({maxParallel: 3}));
        const defs = Array.from({length: 4}, (_unused, index) => newToolUse({id: `tu${index}`}));
        expect(ToolUseService.planExecutionGroups(defs, newTestContext()))
            .toEqual([defs.slice(0, 3), defs.slice(3)]);
    });

    test('holds a mixed group to the tool in it that allows the least', () => {
        const wide = newTool();
        const narrow = newTool({maxParallel: 3});
        mocks.getToolDesc.mockImplementation((_run, name) => name === 'narrow' ? narrow : wide);
        const defs = [
            newToolUse(), newToolUse({id: 'tu2'}),
            newToolUse({id: 'tu3', name: 'narrow'}), newToolUse({id: 'tu4'}),
        ];
        expect(ToolUseService.planExecutionGroups(defs, newTestContext()))
            .toEqual([defs.slice(0, 3), defs.slice(3)]);
    });

    test('looks the tools up for the run they are called in', () => {
        mocks.getToolDesc.mockReturnValue(newTool());
        const context = newTestContext({loopKind: 'sub', role: 'cron'});
        context.loopConfig.mode = 'chat';
        ToolUseService.planExecutionGroups([newToolUse()], context);
        expect(mocks.getToolDesc).toHaveBeenCalledWith(
            {loopKind: 'sub', role: 'cron', mode: 'chat'}, 'demo'
        );
    });
});

describe('executeToolCall output', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('returns the output of the tool as the result', async () => {
        mocks.getToolDesc.mockReturnValue(newTool());
        const {result, success} = await ToolUseService.executeToolCall(newToolUse(), newTestContext());
        expect(result).toEqual({id: 'tu1', content: 'tool output'});
        expect(success).toBe(true);
    });

    test('turns a thrown error into a failed result', async () => {
        mocks.getToolDesc.mockReturnValue(newTool({
            invoke: vi.fn(async () => {
                throw new Error('tool exploded');
            }),
        }));
        const {result, success} = await ToolUseService.executeToolCall(newToolUse(), newTestContext());
        expect(success).toBe(false);
        expect(result.content).toBe('Error: Error: tool exploded');
    });

    test('keeps an output that stays under the truncation threshold', async () => {
        mocks.getToolDesc.mockReturnValue(newTool({invoke: vi.fn(async () => 'x'.repeat(20000))}));
        const {result} = await ToolUseService.executeToolCall(newToolUse(), newTestContext());
        expect(result.content).toHaveLength(20000);
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    test('persists a huge output and answers with a preview', async () => {
        mocks.getToolDesc.mockReturnValue(newTool({invoke: vi.fn(async () => 'x'.repeat(20001))}));
        const context = newTestContext({sessionDir: '.agents/a1/session/s9'});
        const {result, success} = await ToolUseService.executeToolCall(newToolUse(), context);
        expect(mocks.wrapTimestamp).toHaveBeenCalledWith('tu1.txt');
        expect(mocks.writeFile).toHaveBeenCalledWith(
            '.agents/a1/session/s9/tool_results/stamped-tu1.txt', 'x'.repeat(20001)
        );
        expect(success).toBe(true);
        expect(result.content).toContain('Full output saved to: .agents/a1/session/s9/tool_results/stamped-tu1.txt');
        expect(result.content).toContain(`Preview:\n${'x'.repeat(1000)}\n</persisted-output>`);
    });
});
