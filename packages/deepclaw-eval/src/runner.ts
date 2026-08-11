import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { metricsOf, type RunMetrics } from './metrics';
import { newSandbox, removeSandbox } from './sandbox';
import { DEFAULT_TIMEOUT_MS, type EvalScenario, type Grade, type GradeContext } from './scenario';
import { EMPTY_USAGE, type RunTrace } from './trace';

export type CaseResult = {
    scenarioId: string;
    description: string;
    passed: boolean;
    grades: Grade[];
    metrics: RunMetrics;
    trace: RunTrace;
    /** Kept when the run is asked to preserve the sandbox, so a failure can be dug into. */
    home?: string;
};

export type RunOptions = {
    concurrency?: number;
    keepSandbox?: boolean;
};

const CHILD = fileURLToPath(new URL('./child.ts', import.meta.url));

/**
 * The child runs with the sandbox as its working directory so that even the things that
 * ignore DEEPCLAW_HOME, the log folder above all, stay inside the case. That puts the
 * typescript loader out of reach of a bare specifier, so it is resolved here instead.
 */
const TSX_LOADER = resolveTsxLoader();

function resolveTsxLoader(): string {
    try {
        return import.meta.resolve('tsx');
    } catch {
        return 'tsx';
    }
}

export async function runScenarios(
    modulePath: string, scenarios: EvalScenario[], options: RunOptions = {}
): Promise<CaseResult[]> {
    const queue = [...scenarios];
    const results: CaseResult[] = [];
    const workers = Array.from({length: Math.min(options.concurrency || 4, queue.length || 1)},
        async () => {
            for (let scenario = queue.shift(); scenario; scenario = queue.shift()) {
                results.push(await runScenario(modulePath, scenario, options));
            }
        });
    await Promise.all(workers);
    return scenarios.map(scenario => results.find(result => result.scenarioId === scenario.id)!);
}

export async function runScenario(
    modulePath: string, scenario: EvalScenario, options: RunOptions = {}
): Promise<CaseResult> {
    const home = newSandbox();
    const out = join(home, 'eval-trace.json');
    try {
        const timeoutMs = scenario.limits?.timeoutMs || DEFAULT_TIMEOUT_MS;
        const failure = await spawnChild(modulePath, scenario.id, home, out, timeoutMs + 10_000);
        const trace = readTrace(out, scenario.id) || crashTrace(scenario.id, failure || 'no trace written');
        return gradeCase(scenario, trace, home, options.keepSandbox);
    } finally {
        if (!options.keepSandbox) {
            removeSandbox(home);
        }
    }
}

function gradeCase(
    scenario: EvalScenario, trace: RunTrace, home: string, keepSandbox?: boolean
): CaseResult {
    const context: GradeContext = {
        home,
        readFile: path => existsSync(join(home, path)) ? readFileSync(join(home, path), 'utf8') : null,
        exists: path => existsSync(join(home, path)),
    };
    const grades = trace.error
        ? [{name: 'the run finished', passed: false, detail: trace.error}]
        : scenario.graders.flatMap(grader => grader(trace, context));
    return {
        scenarioId: scenario.id,
        description: scenario.description,
        passed: grades.every(result => result.passed),
        grades,
        metrics: metricsOf(trace),
        trace,
        home: keepSandbox ? home : undefined,
    };
}

/** Resolves with an error description, or with nothing when the child exited on its own terms. */
function spawnChild(
    modulePath: string, scenarioId: string, home: string, out: string, timeoutMs: number
): Promise<string | undefined> {
    return new Promise(resolve => {
        const child = spawn(process.execPath, [
            '--import', TSX_LOADER, CHILD,
            '--module', modulePath, '--scenario', scenarioId, '--home', home, '--out', out,
        ], {cwd: home, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, DEEPCLAW_HOME: home}});

        let stderr = '';
        child.stderr.on('data', chunk => stderr += chunk.toString());
        child.stdout.on('data', () => {});

        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve(`Killed after ${timeoutMs}ms`);
        }, timeoutMs);

        child.on('error', error => {
            clearTimeout(timer);
            resolve(`Could not start the run: ${error.message}`);
        });
        child.on('exit', code => {
            clearTimeout(timer);
            resolve(code === 0 ? undefined : `Exited with ${code}\n${stderr.slice(-2000)}`);
        });
    });
}

function readTrace(out: string, scenarioId: string): RunTrace | null {
    if (!existsSync(out)) {
        return null;
    }
    try {
        return {...JSON.parse(readFileSync(out, 'utf8')), scenarioId} as RunTrace;
    } catch {
        return null;
    }
}

function crashTrace(scenarioId: string, error: string): RunTrace {
    return {
        scenarioId,
        startedAt: new Date().toISOString(),
        latencyMs: 0,
        invokeMs: 0,
        turnMs: [],
        error,
        status: 'unknown',
        turns: 0,
        finalText: '',
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
    };
}
