import {beforeEach, describe, expect, test, vi} from 'vitest';
import {newTestContext} from '../../../test-support/one-loop-context';
import {MemoryManager} from '../services/memory-manager';
import {readMemoryDetailTool, saveMemoryTool} from './save-memory-tool';

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {readDir: vi.fn(() => ({})), writeFile: vi.fn()},
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

const addMemory = vi.spyOn(MemoryManager, 'addMemory');
const getMemoryDetail = vi.spyOn(MemoryManager, 'getMemoryDetail');

const memory = {
    type: 'preference' as const,
    name: 'coding_style',
    description: 'preferred style',
    content: 'four spaces',
};

describe('saveMemoryTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        addMemory.mockReturnValue(undefined);
    });

    test('saves a global memory without any owner', async () => {
        const result = await saveMemoryTool.invoke({...memory, scope: 'global'}, newTestContext());
        expect(addMemory).toHaveBeenCalledExactlyOnceWith(memory, 'agent', undefined, undefined);
        expect(result).toBe('Memory saved successfully.');
    });

    test('saves an agent memory under the current agent', async () => {
        await saveMemoryTool.invoke({...memory, scope: 'agent'}, newTestContext());
        expect(addMemory).toHaveBeenCalledExactlyOnceWith(memory, 'agent', 'a1', undefined);
    });

    test('saves a project memory under the current agent and project', async () => {
        const context = newTestContext({projectId: 'p1', role: 'project'});
        await saveMemoryTool.invoke({...memory, scope: 'project'}, context);
        expect(addMemory).toHaveBeenCalledExactlyOnceWith(memory, 'project', 'a1', 'p1');
    });

    test('refuses a project memory when there is no project in context', async () => {
        const result = await saveMemoryTool.invoke({...memory, scope: 'project'}, newTestContext());
        expect(result).toBe('Cannot update a project memory outside project chat.');
        expect(addMemory).not.toHaveBeenCalled();
    });

    test('rejects a name with unsupported characters', async () => {
        const result = await saveMemoryTool.invoke(
            {...memory, name: 'coding style!', scope: 'global'}, newTestContext()
        );
        expect(result).toBe('Invalid memory name. Use only letters, numbers, "_" or "-", length 1-80.');
        expect(addMemory).not.toHaveBeenCalled();
    });

    test('rejects a name longer than eighty characters', async () => {
        const result = await saveMemoryTool.invoke(
            {...memory, name: 'a'.repeat(81), scope: 'global'}, newTestContext()
        );
        expect(result).toContain('Invalid memory name.');
        expect(addMemory).not.toHaveBeenCalled();
    });
});

describe('readMemoryDetailTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        getMemoryDetail.mockReturnValue('the stored body');
    });

    test('returns the body the manager holds for the scope', async () => {
        const result = await readMemoryDetailTool.invoke({name: 'coding_style', scope: 'agent'}, newTestContext());
        expect(getMemoryDetail).toHaveBeenCalledExactlyOnceWith('coding_style', 'agent', 'a1', undefined);
        expect(result).toBe('the stored body');
    });

    test('refuses a project memory when there is no project in context', async () => {
        const result = await readMemoryDetailTool.invoke({name: 'coding_style', scope: 'project'}, newTestContext());
        expect(result).toBe('Cannot get a project memory outside project chat.');
        expect(getMemoryDetail).not.toHaveBeenCalled();
    });

    /** The index a sub loop was given lists the memories of the agent it stands in for. */
    test('reads an agent memory of the agent the run stands for', async () => {
        const context = newTestContext({isSubLoop: true, personaId: 'a2'});
        await readMemoryDetailTool.invoke({name: 'coding_style', scope: 'agent'}, context);
        expect(getMemoryDetail).toHaveBeenCalledExactlyOnceWith('coding_style', 'agent', 'a2', undefined);
    });

    test('leaves a global memory out of the borrowed identity', async () => {
        const context = newTestContext({isSubLoop: true, personaId: 'a2'});
        await readMemoryDetailTool.invoke({name: 'coding_style', scope: 'global'}, context);
        expect(getMemoryDetail).toHaveBeenCalledExactlyOnceWith('coding_style', 'agent', undefined, undefined);
    });

    test('does not validate the memory name before asking the manager', async () => {
        await readMemoryDetailTool.invoke({name: 'not a valid name!', scope: 'global'}, newTestContext());
        expect(getMemoryDetail).toHaveBeenCalledExactlyOnceWith('not a valid name!', 'agent', undefined, undefined);
    });
});

describe('memory tool metadata', () => {

    test('writing is kept out of sub loops while reading is allowed there', () => {
        expect(saveMemoryTool.exclusiveInSubLoop).toBe(true);
        expect(readMemoryDetailTool.exclusiveInSubLoop).toBe(false);
        expect(saveMemoryTool.agentMode).toEqual(['agent', 'chat']);
        expect(saveMemoryTool.tool.schema.required).toEqual(['type', 'name', 'description', 'content', 'scope']);
    });

    test('both memory tools run next to other tool calls', () => {
        expect(saveMemoryTool.parallelSafe).toBe(true);
        expect(readMemoryDetailTool.parallelSafe).toBe(true);
    });
});
