import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { runScenario } from './runner';
import { runnerFixture } from './runner-fixture';
import type { EvalScenario } from './scenario';

const FIXTURE_MODULE = fileURLToPath(new URL('./runner-fixture.ts', import.meta.url));
const RUN_TIMEOUT = 120_000;

describe('running a case end to end', () => {

    test('drives the real loop against the stub and grades what came out', async () => {
        const result = await runScenario(FIXTURE_MODULE, runnerFixture);

        expect(result.trace.error).toBeUndefined();
        expect(result.trace.status).toBe('idle');
        expect(result.trace.turns).toBe(2);
        expect(result.trace.finalText).toContain('Wrote out.md');
        expect(result.trace.toolCalls.map(call => call.name)).toEqual(['write_file']);
        expect(result.trace.usage.outputTokens).toBeGreaterThan(0);
        expect(result.metrics.toolCalls).toBe(1);
    }, RUN_TIMEOUT);

    test('times the loop apart from the seconds the process spends loading itself', async () => {
        const result = await runScenario(FIXTURE_MODULE, runnerFixture);

        expect(result.metrics.invokeMs).toBeGreaterThan(0);
        expect(result.metrics.invokeMs).toBeLessThan(result.metrics.latencyMs);
        expect(result.metrics.turnMs).toHaveLength(2);
        expect(result.metrics.toolMs).toBeLessThanOrEqual(result.metrics.invokeMs);
    }, RUN_TIMEOUT);

    test('measures the prompt the loop really built, not the one the stub invented', async () => {
        const result = await runScenario(FIXTURE_MODULE, runnerFixture);

        const {prompt} = result.metrics;
        expect(prompt.calls).toBe(2);
        // The system prompt and the tool schemas are the bulk of a first call in this product.
        expect(prompt.systemChars).toBeGreaterThan(500);
        expect(prompt.toolsChars).toBeGreaterThan(500);
        expect(prompt.peakCallChars).toBeGreaterThanOrEqual(prompt.firstCallChars);
        expect(prompt.estInputTokens).toBe(Math.round(prompt.totalChars / 4));
    }, RUN_TIMEOUT);

    test('reports the checks that failed, and only those', async () => {
        const result = await runScenario(FIXTURE_MODULE, runnerFixture);

        expect(result.passed).toBe(false);
        expect(result.grades.filter(grade => grade.passed).map(grade => grade.name)).toEqual([
            'status is idle',
            'called write_file with {"filePath":"out.md"}',
            'out.md matches written by the fixture',
        ]);
        expect(result.grades.filter(grade => !grade.passed)).toEqual([
            {name: 'never-written.md matches anything', passed: false, detail: 'file does not exist'},
        ]);
    }, RUN_TIMEOUT);

    test('turns a case that cannot even start into a single failed check', async () => {
        const broken: EvalScenario = {...runnerFixture, id: 'not-exported-anywhere'};

        const result = await runScenario(FIXTURE_MODULE, broken);

        expect(result.passed).toBe(false);
        expect(result.grades).toHaveLength(1);
        expect(result.grades[0]!.name).toBe('the run finished');
        expect(result.grades[0]!.detail).toContain('not-exported-anywhere');
    }, RUN_TIMEOUT);
});
