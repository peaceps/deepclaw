import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Turns a session the product really had into a replay case.
 *
 * The trick is that a recorded history already contains everything the stub needs: what the
 * user asked, and what the model answered turn by turn, tool calls included. Replaying it
 * re-runs today's tools, guards and persistence against yesterday's conversation, which
 * catches "we broke something" for free and scales with usage instead of with hand writing.
 *
 * What it cannot do is prove an improvement: the model's part is frozen by definition.
 *
 * Usage:
 *   npx tsx src/from-session.ts <sessionDir> [--id <scenarioId>] [--out <file>]
 * where <sessionDir> holds messages.jsonl, e.g. {dataRoot}/.agents/{agentId}/session
 */

type Message = {
    role?: string;
    content?: unknown;
    tool_calls?: {id?: string, function?: {name?: string, arguments?: string}}[];
    tool_call_id?: string;
};

export type ReplayInput = {
    id: string;
    messages: Message[];
    /** From session.json; only OpenAIChat histories can drive the stub. */
    llmProtocol?: string;
    /** From session.json, used to write the status assertion. */
    status?: string;
};

export type ReplayResult = {
    source: string;
    warnings: string[];
    turns: number;
    tools: string[];
};

const READ_TOOL = 'read_file';
const ABSOLUTE_OR_ESCAPING = /^([a-zA-Z]:[\\/]|[\\/])|(^|[\\/])\.\.([\\/]|$)/;

export function buildReplayScenario(input: ReplayInput): ReplayResult {
    if (input.llmProtocol && input.llmProtocol !== 'OpenAIChat') {
        throw new Error(
            `Only OpenAIChat histories can be replayed, this session is ${input.llmProtocol}. `
            + 'The stub speaks the OpenAI chat protocol; an Anthropic session needs its own stub.'
        );
    }
    const warnings: string[] = [];
    const conversation = input.messages.filter(message => message.role !== 'system');
    const start = conversation.findIndex(message => message.role === 'user');
    if (start < 0) {
        throw new Error('This history has no user message, so there is nothing to drive.');
    }

    const exchange = untilTheUserSpeaksAgain(conversation, start, warnings);
    const prompt = textOf(conversation[start]!.content, warnings);
    const script = exchange.filter(message => message.role === 'assistant')
        .map(message => turnOf(message, warnings));
    if (!script.length) {
        throw new Error('This history has no assistant answer after the first prompt.');
    }

    const tools = [...new Set(script.flatMap(turn => turn.toolCalls.map(call => call.name)))];
    return {
        source: render(input, prompt, script, seedFilesOf(exchange, warnings), tools),
        warnings,
        turns: script.length,
        tools,
    };
}

/** One invoke is one user turn, so a follow-up question belongs to a case of its own. */
function untilTheUserSpeaksAgain(messages: Message[], start: number, warnings: string[]): Message[] {
    const rest = messages.slice(start + 1);
    const next = rest.findIndex(message => message.role === 'user');
    if (next < 0) {
        return rest;
    }
    warnings.push(
        `The session continues with another user message; only the first exchange was taken `
        + `(${rest.length - next} later messages dropped).`
    );
    return rest.slice(0, next);
}

type Turn = {text: string, toolCalls: {name: string, input: unknown}[]};

function turnOf(message: Message, warnings: string[]): Turn {
    return {
        text: typeof message.content === 'string' ? message.content : '',
        toolCalls: (message.tool_calls || []).map(call => ({
            name: call.function?.name || '',
            input: parseArguments(call.function?.arguments, call.function?.name, warnings),
        })),
    };
}

function parseArguments(args: string | undefined, name: string | undefined, warnings: string[]): unknown {
    if (!args) {
        return {};
    }
    try {
        return JSON.parse(args);
    } catch {
        warnings.push(`The arguments of ${name} were not valid json and became {} in the case.`);
        return {};
    }
}

/**
 * Whatever the agent read during the session is put back on disk, so the replay reads the same
 * bytes instead of failing on a missing file. Long results were truncated when they were
 * recorded, so this is a good approximation rather than the original workspace.
 */
function seedFilesOf(exchange: Message[], warnings: string[]): Record<string, string> {
    const files: Record<string, string> = {};
    // Walked in order, and a call is dropped once its result is in, so a history that reuses
    // a tool call id still pairs each result with the call it belongs to.
    const pending = new Map<string, string>();
    for (const message of exchange) {
        for (const call of message.tool_calls || []) {
            if (call.function?.name !== READ_TOOL || !call.id) {
                continue;
            }
            const path = pathOf(call.function.arguments);
            if (path && ABSOLUTE_OR_ESCAPING.test(path)) {
                warnings.push(`${path} was read from outside the workspace and was not seeded.`);
            } else if (path) {
                pending.set(call.id, path);
            }
        }
        const path = message.tool_call_id && pending.get(message.tool_call_id);
        if (path && typeof message.content === 'string') {
            files[path] = message.content;
            pending.delete(message.tool_call_id!);
        }
    }
    return files;
}

function pathOf(args: string | undefined): string {
    try {
        return JSON.parse(args || '{}').filePath || '';
    } catch {
        return '';
    }
}

function textOf(content: unknown, warnings: string[]): string {
    if (typeof content === 'string') {
        return content;
    }
    const blocks = Array.isArray(content) ? content as {type?: string, text?: string}[] : [];
    if (blocks.some(block => block.type === 'image_url')) {
        warnings.push('The prompt carried images; they are not carried over into the case.');
    }
    return blocks.filter(block => block.type === 'text').map(block => block.text || '').join('\n');
}

function render(
    input: ReplayInput, prompt: string, script: Turn[], files: Record<string, string>, tools: string[]
): string {
    const graders = [
        `expectStatus(${json(input.status || 'idle')})`,
        ...tools.map(tool => `expectToolCalled(${json(tool)})`),
        `expectMaxTurns(${script.length})`,
        'expectScriptFullyConsumed()',
    ];
    const imports = ['expectMaxTurns', 'expectScriptFullyConsumed', 'expectStatus',
        ...(tools.length ? ['expectToolCalled'] : [])].sort();

    return `${header(input.id, script.length, tools)}
import { ${imports.join(', ')} } from '../graders';
import type { EvalScenario } from '../scenario';

export const ${camel(input.id)}: EvalScenario = {
    id: ${json(input.id)},
    description: ${json(describe(script.length, tools))},
${renderSeed(files)}    script: [
${script.map(turn => `        ${renderTurn(turn)},`).join('\n')}
    ],
    driver: {prompt: ${json(prompt)}},
    limits: {maxTurns: ${script.length}},
    graders: [
${graders.map(grader => `        ${grader},`).join('\n')}
    ],
};
`;
}

function header(id: string, turns: number, tools: string[]): string {
    return `// Generated from a recorded session by src/from-session.ts - regenerate, do not hand edit.
//
// A replay case: the script below is what the model actually answered, so running it puts
// today's tools, guards and persistence through yesterday's conversation. It can show that
// something broke; it cannot show that anything got better, because the model's part is fixed.
//
// Review before committing: ${turns} turn(s)${tools.length ? `, tools ${tools.join(', ')}` : ''}, `
        + `and real conversation content of session ${id}.`;
}

function describe(turns: number, tools: string[]): string {
    return `Replay of a recorded session: ${turns} turn(s)`
        + (tools.length ? `, calling ${tools.join(', ')}.` : ', no tools.');
}

function renderSeed(files: Record<string, string>): string {
    const entries = Object.entries(files);
    if (!entries.length) {
        return '';
    }
    return `    seed: {
        // Recovered from what the agent read back then; long reads were truncated on record.
        files: {
${entries.map(([path, content]) => `            ${json(path)}: ${json(content)},`).join('\n')}
        },
    },
`;
}

function renderTurn(turn: Turn): string {
    const parts = [];
    if (turn.text) {
        parts.push(`text: ${json(turn.text)}`);
    }
    if (turn.toolCalls.length) {
        parts.push('toolCalls: [' + turn.toolCalls
            .map(call => `{name: ${json(call.name)}, input: ${JSON.stringify(call.input)}}`)
            .join(', ') + ']');
    }
    return `{${parts.join(', ') || 'text: \'\''}}`;
}

function json(value: string): string {
    return JSON.stringify(value);
}

function camel(id: string): string {
    return id.replace(/[^a-zA-Z0-9]+(.)?/g, (_match, next) => next ? next.toUpperCase() : '')
        .replace(/^[0-9]+/, '') || 'replayScenario';
}

function main(): void {
    const [sessionDir, ...rest] = process.argv.slice(2);
    if (!sessionDir) {
        console.error('Usage: npx tsx src/from-session.ts <sessionDir> [--id <id>] [--out <file>]');
        process.exit(1);
    }
    const flags = parseFlags(rest);
    const dir = resolve(sessionDir);
    const historyPath = join(dir, 'messages.jsonl');
    if (!existsSync(historyPath)) {
        console.error(`No messages.jsonl in ${dir}`);
        process.exit(1);
    }
    const meta = readJson(join(dir, 'session.json'));
    const id = flags['id'] || `replay-${basename(dirname(dir)) || 'session'}`;

    const result = buildReplayScenario({
        id,
        messages: readJsonl(historyPath),
        llmProtocol: meta?.['llmProtocol'],
        status: meta?.['runtime']?.status,
    });

    const out = resolve(flags['out']
        || fileURLToPath(new URL(`./scenarios/${id}.scenario.ts`, import.meta.url)));
    mkdirSync(dirname(out), {recursive: true});
    writeFileSync(out, result.source, 'utf8');

    console.log(`Wrote ${out}: ${result.turns} turn(s)`
        + `${result.tools.length ? `, tools ${result.tools.join(', ')}` : ''}`);
    for (const warning of result.warnings) {
        console.warn(`  warning: ${warning}`);
    }
    console.log('  Read it before committing, it carries real conversation content.');
}

function parseFlags(argv: string[]): Record<string, string> {
    const flags: Record<string, string> = {};
    for (let i = 0; i < argv.length; i += 2) {
        flags[argv[i]!.replace(/^--/, '')] = argv[i + 1] || '';
    }
    return flags;
}

function readJson(path: string): any {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return null;
    }
}

function readJsonl(path: string): Message[] {
    return readFileSync(path, 'utf8').split('\n').filter(line => !!line.trim())
        .map(line => JSON.parse(line) as Message);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
