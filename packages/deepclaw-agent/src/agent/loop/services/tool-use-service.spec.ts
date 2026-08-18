import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type ToolDesc, type ToolGuardResult, type ToolUseDef} from '../../definitions/tool-definitions';
import {newTestContext} from '../../../test-support/one-loop-context';
import {ToolUseService} from './tool-use-service';

const mocks = vi.hoisted(() => ({
    getToolDesc: vi.fn<(loopKind: string, mode: string, name: string) => unknown>(),
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

describe('executeToolCall lookup', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('fails when the tool is unknown to the manager', async () => {
        mocks.getToolDesc.mockReturnValue(undefined);
        const result = await ToolUseService.executeToolCall(newToolUse({name: 'ghost'}), newTestContext());
        expect(result).toEqual({result: {id: 'tu1', content: 'Unknown tool: ghost'}, success: false});
    });

    test('looks the tool up for the current loop kind and agent mode', async () => {
        mocks.getToolDesc.mockReturnValue(newTool());
        const context = newTestContext({loopKind: 'sub'});
        context.loopConfig.mode = 'chat';
        await ToolUseService.executeToolCall(newToolUse(), context);
        expect(mocks.getToolDesc).toHaveBeenCalledWith('sub', 'chat', 'demo');
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

    test('remembers the interrupt reason when the user left the page', async () => {
        const tool = newTool({guard: () => ({
            result: 'ask',
            question: {type: 'input', content: 'may I?'},
            checkAnswer: () => true,
        })});
        mocks.getToolDesc.mockReturnValue(tool);
        const context = newTestContext();
        vi.mocked(context.actions.agentHandler.onInteractionEvent).mockRejectedValue('interactionAfk');
        const {result, success, rerun} = await ToolUseService.executeToolCall(newToolUse(), context);
        expect(success).toBe(false);
        expect(rerun).toBe(true);
        expect(context.runtime.agentBreakReason).toBe('interactionAfk');
        expect(result.content).toContain('Need rerun this tool');
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

    /** The answer of the guard is never consulted, so this one would refuse whatever came in. */
    test('runs a tool whose guard asks inside a sub loop without asking anyone', async () => {
        const tool = newTool({guard: () => ({
            result: 'ask',
            question: {type: 'input', content: 'may I?'},
            checkAnswer: () => false,
        })});
        mocks.getToolDesc.mockReturnValue(tool);
        const context = newTestContext({loopKind: 'sub'});
        const {result, success} = await ToolUseService.executeToolCall(newToolUse(), context);
        expect(success).toBe(true);
        expect(result.content).toBe('tool output');
        expect(context.actions.agentHandler.onInteractionEvent).not.toHaveBeenCalled();
        expect(tool.invoke).toHaveBeenCalled();
        expect(mocks.emitVisitor).not.toHaveBeenCalledWith(
            'toolGuardDenied', expect.anything(), expect.anything()
        );
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

    test('still asks in a top level loop', async () => {
        const tool = newTool({guard: () => ({
            result: 'ask',
            question: {type: 'input', content: 'may I?'},
            checkAnswer: () => true,
        })});
        mocks.getToolDesc.mockReturnValue(tool);
        const context = newTestContext({loopKind: 'main'});
        await ToolUseService.executeToolCall(newToolUse(), context);
        expect(context.actions.agentHandler.onInteractionEvent).toHaveBeenCalled();
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

    /** Without this the whole turn waits for one interaction timeout per queued question. */
    test('stops asking once the user was found to be away', async () => {
        mocks.getToolDesc.mockReturnValue(newAskingTool([]));
        const context = newTestContext();
        vi.mocked(context.actions.agentHandler.onInteractionEvent).mockRejectedValueOnce('interactionAfk');

        const first = ToolUseService.executeToolCall(newToolUse(), context);
        const second = ToolUseService.executeToolCall(newToolUse({id: 'tu2'}), context);
        expect((await first).rerun).toBe(true);
        expect((await second).rerun).toBe(true);
        expect(context.actions.agentHandler.onInteractionEvent).toHaveBeenCalledOnce();
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
        mocks.getToolDesc.mockImplementation((_kind, _mode, name) => name === 'lonely' ? exclusive : safe);
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
        mocks.getToolDesc.mockImplementation((_kind, _mode, name) => name === 'narrow' ? narrow : wide);
        const defs = [
            newToolUse(), newToolUse({id: 'tu2'}),
            newToolUse({id: 'tu3', name: 'narrow'}), newToolUse({id: 'tu4'}),
        ];
        expect(ToolUseService.planExecutionGroups(defs, newTestContext()))
            .toEqual([defs.slice(0, 3), defs.slice(3)]);
    });

    test('looks the tools up for the current loop kind and agent mode', () => {
        mocks.getToolDesc.mockReturnValue(newTool());
        const context = newTestContext({loopKind: 'sub'});
        context.loopConfig.mode = 'chat';
        ToolUseService.planExecutionGroups([newToolUse()], context);
        expect(mocks.getToolDesc).toHaveBeenCalledWith('sub', 'chat', 'demo');
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
