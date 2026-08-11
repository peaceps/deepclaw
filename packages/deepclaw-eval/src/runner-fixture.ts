import { expectFile, expectStatus, expectToolCalled } from './graders';
import type { EvalScenario } from './scenario';

/**
 * The case the runner spec drives. It deliberately carries one check that must pass and one
 * that must fail, so the spec can prove the harness is able to report a red result at all.
 */
export const runnerFixture: EvalScenario = {
    id: 'runner-fixture',
    description: 'A scripted write, graded once truthfully and once against a file nobody wrote.',
    seed: {files: {'in.md': 'source'}},
    script: [
        {toolCalls: [{name: 'write_file', input: {filePath: 'out.md', content: 'written by the fixture'}}]},
        {text: 'Wrote out.md.'},
    ],
    driver: {prompt: 'Copy in.md to out.md.'},
    limits: {maxTurns: 2, timeoutMs: 45_000},
    graders: [
        expectStatus('idle'),
        expectToolCalled('write_file', {filePath: 'out.md'}),
        expectFile('out.md', 'written by the fixture'),
        expectFile('never-written.md', 'anything'),
    ],
};
