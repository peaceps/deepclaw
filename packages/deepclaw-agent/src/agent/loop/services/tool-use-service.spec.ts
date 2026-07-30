import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type ToolDesc, type ToolUseDef} from '../../definitions/tool-definitions';
import {newTestContext} from '../../../test-support/one-loop-context';
import {ToolUseService} from './tool-use-service';

const mocks = vi.hoisted(() => ({
    getToolDesc: vi.fn<(isSubLoop: boolean, mode: string, name: string) => unknown>(),
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
        const context = newTestContext({isSubLoop: true});
        context.loopConfig.mode = 'chat';
        await ToolUseService.executeToolCall(newToolUse(), context);
        expect(mocks.getToolDesc).toHaveBeenCalledWith(true, 'chat', 'demo');
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
        const {result, success} = await ToolUseService.executeToolCall(newToolUse(), context);
        expect(success).toBe(false);
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

    test('runs a tool whose guard allows it right away', async () => {
        const tool = newTool({guard: () => ({result: 'allowed'})});
        mocks.getToolDesc.mockReturnValue(tool);
        const context = newTestContext();
        const {success} = await ToolUseService.executeToolCall(newToolUse(), context);
        expect(success).toBe(true);
        expect(context.actions.agentHandler.onInteractionEvent).not.toHaveBeenCalled();
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
