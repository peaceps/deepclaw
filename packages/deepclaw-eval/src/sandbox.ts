import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_AGENT_ID, type ScenarioSeed } from './scenario';

const CONFIG_FILE = '.deepclaw.config.json';

export function newSandbox(): string {
    return mkdtempSync(join(tmpdir(), 'deepclaw-eval-'));
}

export function removeSandbox(home: string): void {
    rmSync(home, {recursive: true, force: true});
}

/**
 * Lays out a whole deepclaw installation in an empty directory: the config that points the
 * agent at the stub, plus whatever files and projects the case says already existed. Anything
 * else the agent needs is created by the product itself on first use.
 */
export function seedSandbox(home: string, seed: ScenarioSeed, baseURL: string): void {
    writeJson(join(home, CONFIG_FILE), {
        manager: {name: 'Deepclaw', title: 'CEO', avatar: '🐋'},
        agents: [{
            id: seed.agentId || DEFAULT_AGENT_ID,
            name: seed.agentName || 'Eval',
            mode: seed.mode || 'agent',
            im: {enabled: false},
            llm: {baseURL, apiKey: 'eval-key', model: 'eval-stub'},
        }],
        ui: {lang: seed.lang || 'en'},
        advanced: {},
    });
    for (const [path, content] of Object.entries(seed.files || {})) {
        writeText(join(home, path), content);
    }
    for (const project of seed.projects || []) {
        writeJson(join(home, '.projects', project.id, 'project.json'), project);
    }
}

function writeText(path: string, content: string): void {
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, content, 'utf8');
}

function writeJson(path: string, value: unknown): void {
    writeText(path, JSON.stringify(value, null, 2));
}
