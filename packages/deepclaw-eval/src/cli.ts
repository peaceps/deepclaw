import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatReport, newReport } from './report';
import { runScenarios } from './runner';
import type { EvalScenario } from './scenario';

const SCENARIO_DIR = fileURLToPath(new URL('./scenarios', import.meta.url));

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const filter = args.filter(arg => !arg.startsWith('-'));
    const keepSandbox = args.includes('--keep');

    const files = readdirSync(SCENARIO_DIR).filter(file => file.endsWith('.scenario.ts'));
    const cases: {modulePath: string, scenario: EvalScenario}[] = [];
    for (const file of files) {
        const modulePath = join(SCENARIO_DIR, file);
        const exported = await import(pathToFileURL(modulePath).href) as Record<string, unknown>;
        for (const value of Object.values(exported)) {
            if (isScenario(value) && (!filter.length || filter.some(name => value.id.includes(name)))) {
                cases.push({modulePath, scenario: value});
            }
        }
    }
    if (!cases.length) {
        console.error(`No scenario matched ${filter.join(', ') || '(everything)'}`);
        process.exit(1);
    }

    const results = [];
    // Cases of one file share a module path, so they are grouped and each group runs its own
    // batch of child processes.
    for (const modulePath of [...new Set(cases.map(entry => entry.modulePath))]) {
        const scenarios = cases.filter(entry => entry.modulePath === modulePath).map(entry => entry.scenario);
        results.push(...await runScenarios(modulePath, scenarios, {keepSandbox}));
    }

    const report = newReport(results);
    console.log(formatReport(report));
    process.exit(report.failed ? 1 : 0);
}

function isScenario(value: unknown): value is EvalScenario {
    return !!value && typeof value === 'object' && 'id' in value && 'script' in value && 'graders' in value;
}

main();
