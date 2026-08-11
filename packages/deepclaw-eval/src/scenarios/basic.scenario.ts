import {
    expectFinalText, expectMaxTurns, expectNoUnexpectedQuestion, expectScriptFullyConsumed,
    expectStatus, expectToolCalled, expectToolOffered, expectAllToolsSucceeded, expectFile,
    expectNoToolCalled, expectPromptUnder,
} from '../graders';
import type { EvalScenario } from '../scenario';

export const answersWithoutTools: EvalScenario = {
    id: 'answers-without-tools',
    description: 'A question that needs no tool is answered in a single turn and the loop settles.',
    script: [
        {text: 'The answer is 42.'},
    ],
    driver: {prompt: 'What is the answer to life, the universe and everything?'},
    limits: {maxTurns: 1},
    graders: [
        expectStatus('idle'),
        expectFinalText('The answer is 42.'),
        expectMaxTurns(1),
        expectNoToolCalled('run_sync_command'),
        // Today one agent-mode call is about 24KB, four fifths of it tool schemas. The ceiling
        // is there to make a jump in that baseline show up as a failing case, not as a bill.
        expectPromptUnder({perCallChars: 30_000}),
        expectScriptFullyConsumed(),
        expectNoUnexpectedQuestion(),
    ],
};

export const readsThenWrites: EvalScenario = {
    id: 'reads-then-writes',
    description: 'A read, a write and a closing word: the tool results must come back and the file must land on disk.',
    seed: {
        files: {'notes/todo.md': '- buy milk\n- feed the whale\n'},
    },
    script: [
        {toolCalls: [{name: 'read_file', input: {filePath: 'notes/todo.md'}}]},
        {
            text: 'Writing the summary now. ',
            toolCalls: [{name: 'write_file', input: {filePath: 'notes/summary.md', content: '2 open items\n'}}],
        },
        {text: 'Summarised 2 open items.'},
    ],
    driver: {prompt: 'Summarise notes/todo.md into notes/summary.md.'},
    limits: {maxTurns: 3},
    graders: [
        expectStatus('idle'),
        expectToolOffered('write_file'),
        expectToolCalled('read_file', {filePath: 'notes/todo.md'}),
        expectToolCalled('write_file'),
        expectAllToolsSucceeded(),
        expectFile('notes/summary.md', '2 open items'),
        expectFinalText(/Summarised 2 open items/),
        expectMaxTurns(3),
        expectScriptFullyConsumed(),
    ],
};
