import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { startLLMStub } from './llm-stub';
import { seedSandbox } from './sandbox';
import { DEFAULT_AGENT_ID, DEFAULT_TIMEOUT_MS, type EvalScenario } from './scenario';
import { EMPTY_USAGE, type RunTrace } from './trace';

/**
 * One case, one process. The data root is only settable through an environment variable that
 * the config reads once at import time, so isolation has to happen before the first import of
 * anything from the product - which is why everything below is loaded lazily.
 */
async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    process.env['DEEPCLAW_HOME'] = args['home']!;

    const scenario = await loadScenario(args['module']!, args['scenario']!);
    const startedAt = new Date();
    const started = Date.now();
    let trace: RunTrace;
    try {
        trace = await run(scenario, args['home']!);
    } catch (error) {
        trace = {
            ...emptyTrace(scenario.id, startedAt),
            error: error instanceof Error ? `${error.message}\n${error.stack}` : String(error),
        };
    }
    trace.latencyMs = Date.now() - started;
    writeFileSync(args['out']!, JSON.stringify(trace, null, 2), 'utf8');
    // The loop may leave timers or an open MCP client behind; the trace is safe on disk by now.
    process.exit(0);
}

async function run(scenario: EvalScenario, home: string): Promise<RunTrace> {
    const startedAt = new Date();
    const seed = scenario.seed || {};
    const agentId = seed.agentId || DEFAULT_AGENT_ID;
    const role = scenario.driver.role || 'agent';
    const projectId = scenario.driver.projectId || '';

    const stub = await startLLMStub(scenario.script);
    seedSandbox(home, seed, stub.url);

    const {LoopInitializer, SessionService} = await import('@deepclaw/agent');
    const {init} = await import('@deepclaw/i18n');
    init(seed.lang || 'en');

    const {TraceHandler} = await import('./trace-handler');
    const {installTraceHooks} = await import('./trace-hooks');
    const {readDiskTrace} = await import('./disk-trace');

    const handler = new TraceHandler(scenario.interaction);
    const hooks = installTraceHooks(scenario.limits?.maxTurns);

    const loop = LoopInitializer.getLoop(role, agentId, projectId, handler);
    // Timed as tightly as possible around the loop: importing the product packages costs
    // seconds and would drown out everything the case is actually measuring.
    const invokeStarted = Date.now();
    const response = await withTimeout(
        loop.invoke(scenario.driver.prompt, {browserId: 'eval', images: scenario.driver.images}),
        scenario.limits?.timeoutMs || DEFAULT_TIMEOUT_MS,
    );
    const invokeMs = Date.now() - invokeStarted;
    await stub.close();

    const disk = readDiskTrace(home, SessionService.getSessionDir(role, agentId, projectId), projectId);
    return {
        ...emptyTrace(scenario.id, startedAt),
        invokeMs,
        turnMs: hooks.turnMs,
        status: disk.status,
        transitionReason: response.runtime.transitionReason || disk.transitionReason,
        breakReason: response.runtime.agentBreakReason,
        // session.json carries no turn count of its own, so the runtime of the run is the
        // only place that knows how many times the model was asked.
        turns: response.runtime.turnCount || disk.turns,
        finalText: response.text,
        toolCalls: hooks.toolCalls,
        guardDenied: hooks.guardDenied,
        compactions: hooks.compactions,
        interrupts: hooks.interrupts,
        usage: disk.usage || response.runtime.usage || EMPTY_USAGE,
        llmRequests: stub.requests,
        scriptExhausted: stub.exhausted,
        projectFinal: disk.project,
        messages: disk.messages,
        infoEvents: handler.infoEvents,
        unexpectedInteractions: handler.unexpectedInteractions,
    };
}

function emptyTrace(scenarioId: string, startedAt: Date): RunTrace {
    return {
        scenarioId,
        startedAt: startedAt.toISOString(),
        latencyMs: 0,
        invokeMs: 0,
        turnMs: [],
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

async function loadScenario(modulePath: string, scenarioId: string): Promise<EvalScenario> {
    const exported = await import(pathToFileURL(modulePath).href) as Record<string, unknown>;
    const scenario = Object.values(exported)
        .find(value => isScenario(value) && value.id === scenarioId);
    if (!scenario) {
        throw new Error(`Scenario "${scenarioId}" not exported by ${modulePath}`);
    }
    return scenario as EvalScenario;
}

function isScenario(value: unknown): value is EvalScenario {
    return !!value && typeof value === 'object' && 'id' in value && 'script' in value;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_resolve, reject) =>
            setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms).unref()
        ),
    ]);
}

function parseArgs(argv: string[]): Record<string, string> {
    const args: Record<string, string> = {};
    for (let i = 0; i < argv.length; i += 2) {
        args[argv[i]!.replace(/^--/, '')] = argv[i + 1] || '';
    }
    return args;
}

main();
