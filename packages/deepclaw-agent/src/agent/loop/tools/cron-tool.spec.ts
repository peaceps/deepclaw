import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type CronTask} from '@deepclaw/core';
import {newTestContext} from '../../../test-support/one-loop-context';
import {CronService, MAX_DISPLAY_HISTORIES} from '../services/cron-service';
import {createCronTaskTool, updateCronOutputTool, updateCronTaskTool} from './cron-tool';

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {exists: vi.fn(() => false), readDir: vi.fn(() => ({})), writeFile: vi.fn()},
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

const createCronTask = vi.spyOn(CronService, 'createCronTask');
const updateCronTask = vi.spyOn(CronService, 'updateCronTask');
const updateCronOutput = vi.spyOn(CronService, 'updateCronOutput');
const getCronTaskDetail = vi.spyOn(CronService, 'getCronTaskDetail');

function cronTask(overrides: Partial<CronTask> = {}): CronTask {
    return {id: 'c1', title: 'nightly digest', cron: '0 0 * * *', prompt: 'digest', ...overrides} as CronTask;
}

describe('createCronTaskTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        createCronTask.mockReturnValue(cronTask());
        getCronTaskDetail.mockReturnValue(cronTask({histories: []}));
    });

    test('creates the task with the current agent as its creator', async () => {
        await createCronTaskTool.invoke(
            {title: 'nightly digest', cron: '0 0 * * *', prompt: 'digest'}, newTestContext()
        );
        expect(createCronTask).toHaveBeenCalledExactlyOnceWith('nightly digest', 'a1', '0 0 * * *', 'digest');
    });

    test('answers with the detail of the task it just created', async () => {
        const result = await createCronTaskTool.invoke(
            {title: 'nightly digest', cron: '0 0 * * *', prompt: 'digest'}, newTestContext()
        );
        expect(getCronTaskDetail).toHaveBeenCalledExactlyOnceWith('c1');
        expect(result).toContain('Cron task created successfully');
        expect(result).toContain(JSON.stringify(cronTask({histories: []})));
    });
});

describe('updateCronTaskTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        updateCronTask.mockReturnValue(cronTask());
        getCronTaskDetail.mockReturnValue(cronTask({histories: []}));
    });

    test('forwards the patch untouched to the service', async () => {
        await updateCronTaskTool.invoke({id: 'c1', title: 'weekly digest'}, newTestContext());
        expect(updateCronTask).toHaveBeenCalledExactlyOnceWith({id: 'c1', title: 'weekly digest'});
    });

    test('answers with the detail of the updated task', async () => {
        const result = await updateCronTaskTool.invoke({id: 'c1', cron: '0 9 * * 1'}, newTestContext());
        expect(result).toContain('Cron task updated successfully');
        expect(result).toContain('"id":"c1"');
    });
});

describe('updateCronOutputTool invoke', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        updateCronOutput.mockReturnValue(undefined);
        getCronTaskDetail.mockReturnValue(cronTask({histories: []}));
    });

    test('stores the output on the task', async () => {
        const output = {type: 'markdown' as const, content: '# report'};
        await updateCronOutputTool.invoke({id: 'c1', output}, newTestContext());
        expect(updateCronOutput).toHaveBeenCalledExactlyOnceWith('c1', output);
    });

    test('tells the agent how many histories the detail contains', async () => {
        const result = await updateCronOutputTool.invoke(
            {id: 'c1', output: {type: 'text', content: 'done'}}, newTestContext()
        );
        expect(result).toContain(`last max ${MAX_DISPLAY_HISTORIES} histories`);
    });
});

describe('cron tool metadata', () => {

    test('every cron tool is kept out of sub loops but runs next to other tool calls', () => {
        for (const tool of [createCronTaskTool, updateCronTaskTool, updateCronOutputTool]) {
            expect(tool.parallelSafe).toBe(true);
            expect(tool.exclusiveInSubLoop).toBe(true);
            expect(tool.agentMode).toEqual(['agent']);
        }
        expect(updateCronTaskTool.tool.schema.required).toEqual(['id']);
    });
});
