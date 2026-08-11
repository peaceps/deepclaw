import { describe, expect, test } from 'vitest';
import { buildReplayScenario, type ReplayInput } from './from-session';

function build(messages: unknown[], overrides: Partial<ReplayInput> = {}) {
    return buildReplayScenario({
        id: 'replay-a1', messages: messages as ReplayInput['messages'], status: 'idle', ...overrides,
    });
}

const SYSTEM = {role: 'system', content: 'you are a whale'};
const ASKED = {role: 'user', content: 'Summarise notes/todo.md.'};
const READ = {
    role: 'assistant', content: '',
    tool_calls: [{id: 'call_1', type: 'function',
        function: {name: 'read_file', arguments: '{"filePath":"notes/todo.md"}'}}],
};
const RESULT = {role: 'tool', tool_call_id: 'call_1', content: '- buy milk\n- feed the whale'};
const ANSWERED = {role: 'assistant', content: 'Two things are open.'};

describe('turning a recorded session into a case', () => {

    test('drives the case with the first thing the user said', () => {
        const {source} = build([SYSTEM, ASKED, ANSWERED]);

        expect(source).toContain('driver: {prompt: "Summarise notes/todo.md."}');
    });

    test('replays each assistant answer as one scripted turn', () => {
        const {source, turns} = build([SYSTEM, ASKED, READ, RESULT, ANSWERED]);

        expect(turns).toBe(2);
        expect(source).toContain(
            '{toolCalls: [{name: "read_file", input: {"filePath":"notes/todo.md"}}]}'
        );
        expect(source).toContain('{text: "Two things are open."}');
    });

    test('puts back the files the agent had read, so the replay reads the same bytes', () => {
        const {source} = build([SYSTEM, ASKED, READ, RESULT, ANSWERED]);

        expect(source).toContain('"notes/todo.md": "- buy milk\\n- feed the whale"');
    });

    test('pairs each read with its own result even when the ids repeat', () => {
        const readOther = {role: 'assistant', content: '', tool_calls: [{id: 'call_1',
            type: 'function', function: {name: 'read_file', arguments: '{"filePath":"other.md"}'}}]};
        const otherResult = {role: 'tool', tool_call_id: 'call_1', content: 'contents of other'};

        const {source} = build([SYSTEM, ASKED, READ, RESULT, readOther, otherResult, ANSWERED]);

        expect(source).toContain('"notes/todo.md": "- buy milk\\n- feed the whale"');
        expect(source).toContain('"other.md": "contents of other"');
    });

    test('refuses to seed a file the agent read from outside the workspace', () => {
        const outside = {...READ, tool_calls: [{id: 'call_1', type: 'function',
            function: {name: 'read_file', arguments: '{"filePath":"/etc/passwd"}'}}]};

        const {source, warnings} = build([SYSTEM, ASKED, outside, RESULT, ANSWERED]);

        expect(source).not.toContain('seed:');
        expect(warnings[0]).toContain('/etc/passwd');
    });

    test('writes assertions out of how the session really ended', () => {
        const {source} = build([SYSTEM, ASKED, READ, RESULT, ANSWERED], {status: 'paused'});

        expect(source).toContain('expectStatus("paused")');
        expect(source).toContain('expectToolCalled("read_file")');
        expect(source).toContain('expectMaxTurns(2)');
        expect(source).toContain('expectScriptFullyConsumed()');
    });

    test('imports exactly the graders it wrote', () => {
        const withoutTools = build([SYSTEM, ASKED, ANSWERED]).source;

        expect(withoutTools).toContain(
            "import { expectMaxTurns, expectScriptFullyConsumed, expectStatus } from '../graders';"
        );
        expect(withoutTools).not.toContain('expectToolCalled');
    });

    test('stops at the second user message and says how much it left behind', () => {
        const {turns, warnings} = build([
            SYSTEM, ASKED, ANSWERED, {role: 'user', content: 'and now?'}, {role: 'assistant', content: 'later'},
        ]);

        expect(turns).toBe(1);
        expect(warnings[0]).toContain('only the first exchange');
    });

    test('keeps the text of an image prompt and warns that the image is gone', () => {
        const {source, warnings} = build([SYSTEM, {role: 'user', content: [
            {type: 'text', text: 'what is this?'},
            {type: 'image_url', image_url: {url: 'dcimg://abc.png'}},
        ]}, ANSWERED]);

        expect(source).toContain('driver: {prompt: "what is this?"}');
        expect(warnings[0]).toContain('images');
    });

    test('falls back to empty arguments when the recorded json was broken', () => {
        const broken = {...READ, tool_calls: [{id: 'c', type: 'function',
            function: {name: 'read_file', arguments: '{not json'}}]};

        const {source, warnings} = build([SYSTEM, ASKED, broken, ANSWERED]);

        expect(source).toContain('{name: "read_file", input: {}}');
        expect(warnings[0]).toContain('not valid json');
    });

    test('names the export after the scenario id', () => {
        expect(build([SYSTEM, ASKED, ANSWERED]).source)
            .toContain('export const replayA1: EvalScenario');
    });

    test('turns an unreplayable history into a plain refusal', () => {
        expect(() => build([SYSTEM, ASKED, ANSWERED], {llmProtocol: 'Anthropic'}))
            .toThrow(/Only OpenAIChat/);
        expect(() => build([SYSTEM, {role: 'assistant', content: 'hi'}]))
            .toThrow(/no user message/);
        expect(() => build([SYSTEM, ASKED]))
            .toThrow(/no assistant answer/);
    });
});
