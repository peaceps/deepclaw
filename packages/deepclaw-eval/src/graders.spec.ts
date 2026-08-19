import type { Project } from '@deepclaw/core';
import { describe, expect, test } from 'vitest';
import {
    expectAllToolsSucceeded, expectFile, expectFinalText, expectMaxTurns, expectNoToolCalled,
    expectNoUnexpectedQuestion, expectProject, expectPromptUnder, expectScriptFullyConsumed,
    expectStatus, expectToolCalled, expectToolNotOffered, expectToolOffered,
} from './graders';
import type { Grade, GradeContext } from './scenario';
import { EMPTY_USAGE, type RunTrace } from './trace';

function newTrace(overrides: Partial<RunTrace> = {}): RunTrace {
    return {
        scenarioId: 'case',
        startedAt: '',
        latencyMs: 0,
        invokeMs: 0,
        turnMs: [],
        status: 'idle',
        turns: 1,
        finalText: 'all done',
        toolCalls: [],
        guardDenied: [],
        compactions: {toolResults: 0, history: 0},
        interrupts: [],
        usage: EMPTY_USAGE,
        llmRequests: [],
        scriptExhausted: false,
        messages: [],
        infoEvents: [],
        unexpectedInteractions: [],
        ...overrides,
    };
}

const files: Record<string, string> = {'notes/summary.md': '2 open items'};
const context: GradeContext = {
    home: '/sandbox',
    readFile: path => files[path] ?? null,
    exists: path => path in files,
};

function run(grader: ReturnType<typeof expectStatus>, trace: RunTrace): Grade {
    return grader(trace, context) as Grade;
}

describe('status and text graders', () => {

    test('passes when the run settled as expected', () => {
        expect(run(expectStatus('idle'), newTrace()).passed).toBe(true);
    });

    test('fails and says what the status really was', () => {
        const grade = run(expectStatus('idle'), newTrace({status: 'error'}));
        expect(grade.passed).toBe(false);
        expect(grade.detail).toContain('error');
    });

    test('matches the final text by substring and by pattern', () => {
        expect(run(expectFinalText('all done'), newTrace()).passed).toBe(true);
        expect(run(expectFinalText(/ALL/i), newTrace()).passed).toBe(true);
        expect(run(expectFinalText('nothing like it'), newTrace()).passed).toBe(false);
    });

    test('holds the run to its turn budget', () => {
        expect(run(expectMaxTurns(3), newTrace({turns: 3})).passed).toBe(true);
        expect(run(expectMaxTurns(3), newTrace({turns: 4})).passed).toBe(false);
    });
});

describe('tool graders', () => {

    const withCalls = newTrace({
        toolCalls: [
            {name: 'read_file', input: {filePath: 'notes/todo.md'}, ok: true, ms: 3},
            {name: 'write_file', input: '{"filePath":"notes/summary.md"}', ok: false, ms: 5},
        ],
    });

    test('finds a tool call by name', () => {
        expect(run(expectToolCalled('read_file'), withCalls).passed).toBe(true);
        expect(run(expectToolCalled('run_sync_command'), withCalls).passed).toBe(false);
    });

    test('checks the arguments, whether they arrived parsed or as json text', () => {
        expect(run(expectToolCalled('read_file', {filePath: 'notes/todo.md'}), withCalls).passed).toBe(true);
        expect(run(expectToolCalled('write_file', {filePath: 'notes/summary.md'}), withCalls).passed).toBe(true);
        expect(run(expectToolCalled('read_file', {filePath: 'elsewhere.md'}), withCalls).passed).toBe(false);
    });

    test('catches a tool that should not have been touched', () => {
        expect(run(expectNoToolCalled('run_sync_command'), withCalls).passed).toBe(true);
        expect(run(expectNoToolCalled('read_file'), withCalls).passed).toBe(false);
    });

    test('notices a tool call that came back as a failure', () => {
        expect(run(expectAllToolsSucceeded(), withCalls).passed).toBe(false);
        expect(run(expectAllToolsSucceeded(), newTrace()).passed).toBe(true);
    });
});

describe('graders that read the request the model got', () => {

    const offered = newTrace({
        llmRequests: [{
            model: 'stub', messages: [], tools: [{function: {name: 'read_file'}}],
        }],
    });

    test('sees which tools were on the table', () => {
        expect(run(expectToolOffered('read_file'), offered).passed).toBe(true);
        expect(run(expectToolOffered('write_file'), offered).passed).toBe(false);
    });

    test('sees which tools were kept off the table', () => {
        expect(run(expectToolNotOffered('run_sync_command'), offered).passed).toBe(true);
        expect(run(expectToolNotOffered('read_file'), offered).passed).toBe(false);
    });
});

describe('graders that look at the sandbox and the run itself', () => {

    test('reads a file the agent left behind', () => {
        expect(run(expectFile('notes/summary.md', '2 open items'), newTrace()).passed).toBe(true);
        expect(run(expectFile('notes/summary.md', 'something else'), newTrace()).passed).toBe(false);
    });

    test('says so plainly when the file is not there at all', () => {
        const grade = run(expectFile('notes/missing.md', 'x'), newTrace());
        expect(grade.passed).toBe(false);
        expect(grade.detail).toBe('file does not exist');
    });

    test('flags a question nobody was there to answer', () => {
        expect(run(expectNoUnexpectedQuestion(), newTrace()).passed).toBe(true);
        expect(run(expectNoUnexpectedQuestion(),
            newTrace({unexpectedInteractions: ['may I?']})).passed).toBe(false);
    });

    test('flags a loop that kept thinking past the script', () => {
        expect(run(expectScriptFullyConsumed(), newTrace()).passed).toBe(true);
        expect(run(expectScriptFullyConsumed(), newTrace({scriptExhausted: true})).passed).toBe(false);
    });
});

describe('the prompt budget grader', () => {

    // Two calls of 30 and 46 characters of json, by the counting in promptMetricsOf.
    const trace = newTrace({
        llmRequests: [
            {model: 'stub', messages: [{role: 'system', content: 'abc'}], tools: []},
            {model: 'stub', messages: [{role: 'system', content: 'abc'}, {role: 'user', content: 'hi'}], tools: []},
        ],
    });

    test('passes when both budgets are respected', () => {
        const grades = expectPromptUnder({perCallChars: 200, totalChars: 400})(trace, context) as Grade[];

        expect(grades).toHaveLength(2);
        expect(grades.every(grade => grade.passed)).toBe(true);
    });

    test('fails the per call budget and says how far over it went', () => {
        const grades = expectPromptUnder({perCallChars: 10})(trace, context) as Grade[];

        expect(grades[0]!.passed).toBe(false);
        expect(grades[0]!.detail).toMatch(/^peaked at \d+$/);
    });

    test('fails the total budget on its own', () => {
        const grades = expectPromptUnder({totalChars: 10})(trace, context) as Grade[];

        expect(grades).toHaveLength(1);
        expect(grades[0]!.passed).toBe(false);
    });
});

describe('the project grader', () => {

    const project: Project = {
        id: 'p1',
        title: 'Ship 0.4',
        description: 'notes and an announcement',
        createdAt: '2026-01-01T00:00:00.000Z',
        creator: 'eval-agent',
        priority: 'high',
        tasks: {
            Draft: {
                id: 'Draft', title: 'Draft', description: 'the notes', status: 'ongoing', priority: 'high',
                blockedBy: [], blocks: [], stepsStatus: {steps: ['read', 'write'], currentStepIndex: 1},
            },
            Announce: {
                id: 'Announce', title: 'Announce', description: 'the release', status: 'done', priority: 'low',
                blockedBy: [], blocks: [],
            },
        },
        completedTasks: ['Announce'],
        ongoingTasks: ['Draft'],
        canStartTasks: [],
    };

    test('judges the project the run left on disk', () => {
        const trace = newTrace({projectFinal: project});

        expect(run(expectProject(p => p?.id === 'p1'), trace).passed).toBe(true);
        expect(run(expectProject(p => !!p?.closedAt), trace).passed).toBe(false);
    });

    test('describes a failure by task state rather than by dumping the project', () => {
        const grade = run(expectProject(p => !!p?.closedAt, 'the project closed'),
            newTrace({projectFinal: project}));

        expect(grade.detail).toBe('Ship 0.4 (open) | Draft: ongoing step 1/2 | Announce: done');
    });

    test('says the project is missing instead of pretending it failed a check', () => {
        expect(run(expectProject(() => false), newTrace()).detail).toBe('no project on disk');
    });
});
