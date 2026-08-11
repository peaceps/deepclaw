import { promptMetricsOf } from './metrics';
import type { Grade, Grader } from './scenario';
import type { RunTrace } from './trace';

/** How the run ended, as it was written to the session file. */
export function expectStatus(status: 'idle' | 'paused' | 'error' | 'running'): Grader {
    return trace => grade(`status is ${status}`, trace.status === status, `was ${trace.status}`);
}

export function expectFinalText(matcher: RegExp | string): Grader {
    return trace => grade(
        `final text matches ${matcher}`,
        matches(trace.finalText, matcher),
        JSON.stringify(trace.finalText.slice(0, 200)),
    );
}

export function expectToolCalled(name: string, input?: Record<string, unknown>): Grader {
    return trace => {
        const calls = trace.toolCalls.filter(call => call.name === name);
        if (!calls.length) {
            return grade(`called ${name}`, false, `called ${describeCalls(trace)}`);
        }
        if (!input) {
            return grade(`called ${name}`, true);
        }
        const matched = calls.some(call => containsAll(call.input, input));
        return grade(`called ${name} with ${JSON.stringify(input)}`, matched,
            `inputs were ${JSON.stringify(calls.map(call => call.input))}`);
    };
}

export function expectNoToolCalled(name: string): Grader {
    return trace => grade(
        `never called ${name}`,
        !trace.toolCalls.some(call => call.name === name),
        `called ${describeCalls(trace)}`,
    );
}

export function expectAllToolsSucceeded(): Grader {
    return trace => {
        const failed = trace.toolCalls.filter(call => !call.ok);
        return grade('every tool call succeeded', !failed.length,
            `failed: ${failed.map(call => call.name).join(', ')}`);
    };
}

/**
 * Asserts on the tool list the model was actually offered, which is how the mode of an agent
 * is enforced: a chat agent must never even be shown the keys to the machine.
 */
export function expectToolNotOffered(name: string): Grader {
    return trace => {
        const offered = trace.llmRequests.some(
            request => request.tools.some(tool => tool.function?.name === name)
        );
        return grade(`${name} not offered to the model`, !offered);
    };
}

export function expectToolOffered(name: string): Grader {
    return trace => {
        const offered = trace.llmRequests.some(
            request => request.tools.some(tool => tool.function?.name === name)
        );
        return grade(`${name} offered to the model`, offered);
    };
}

/**
 * A budget on what we send the model. The character counts come from our own code, not from
 * the model, so they hold still between runs and a threshold here really does catch a system
 * prompt or a tool schema that quietly doubled.
 */
export function expectPromptUnder(limits: {perCallChars?: number, totalChars?: number}): Grader {
    return trace => {
        const prompt = promptMetricsOf(trace.llmRequests);
        const grades: Grade[] = [];
        if (limits.perCallChars) {
            grades.push(grade(`no single call over ${limits.perCallChars} chars`,
                prompt.peakCallChars <= limits.perCallChars, `peaked at ${prompt.peakCallChars}`));
        }
        if (limits.totalChars) {
            grades.push(grade(`at most ${limits.totalChars} chars sent in total`,
                prompt.totalChars <= limits.totalChars, `sent ${prompt.totalChars}`));
        }
        return grades;
    };
}

export function expectMaxTurns(max: number): Grader {
    return trace => grade(`at most ${max} turns`, trace.turns <= max, `took ${trace.turns}`);
}

export function expectFile(path: string, matcher: RegExp | string): Grader {
    return (_trace, context) => {
        const content = context.readFile(path);
        if (content === null) {
            return grade(`${path} matches ${matcher}`, false, 'file does not exist');
        }
        return grade(`${path} matches ${matcher}`, matches(content, matcher),
            JSON.stringify(content.slice(0, 200)));
    };
}

export function expectNoUnexpectedQuestion(): Grader {
    return trace => grade('asked nothing the scenario did not foresee',
        !trace.unexpectedInteractions.length, trace.unexpectedInteractions.join(' | '));
}

/** The script running dry means the loop kept thinking after the case expected it to stop. */
export function expectScriptFullyConsumed(): Grader {
    return trace => grade('the model was asked exactly as often as scripted',
        !trace.scriptExhausted, `${trace.llmRequests.length} calls`);
}

export function expectProject(check: (project: RunTrace['projectFinal']) => boolean, name = 'project matches'): Grader {
    return trace => grade(name, check(trace.projectFinal), describeProject(trace.projectFinal));
}

/** A whole project as JSON says nothing in a report line; its tasks and their state say everything. */
function describeProject(project: RunTrace['projectFinal']): string {
    if (!project) {
        return 'no project on disk';
    }
    const tasks = Object.values(project.tasks).map(task => {
        const steps = task.stepsStatus;
        const progress = steps ? ` step ${steps.currentStepIndex}/${steps.steps.length}` : '';
        return `${task.title}: ${task.status}${progress}`;
    });
    return [`${project.title} (${project.closedAt ? 'closed' : 'open'})`, ...tasks].join(' | ');
}

function grade(name: string, passed: boolean, detail?: string): Grade {
    return passed ? {name, passed} : {name, passed, detail};
}

function matches(value: string, matcher: RegExp | string): boolean {
    return typeof matcher === 'string' ? value.includes(matcher) : matcher.test(value);
}

function containsAll(actual: unknown, expected: Record<string, unknown>): boolean {
    const input = parseInput(actual);
    return Object.entries(expected).every(([key, value]) =>
        JSON.stringify(input[key]) === JSON.stringify(value));
}

function parseInput(input: unknown): Record<string, unknown> {
    if (typeof input === 'string') {
        try {
            return JSON.parse(input);
        } catch {
            return {};
        }
    }
    return (input || {}) as Record<string, unknown>;
}

function describeCalls(trace: RunTrace): string {
    return trace.toolCalls.map(call => call.name).join(', ') || 'nothing';
}
