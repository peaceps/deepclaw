import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { newSandbox, removeSandbox, seedSandbox } from './sandbox';

let home = '';

afterEach(() => {
    if (home) {
        removeSandbox(home);
        home = '';
    }
});

function readConfig(): any {
    return JSON.parse(readFileSync(join(home, '.deepclaw.config.json'), 'utf8'));
}

describe('seeding a sandbox', () => {

    test('writes a config with one agent pointed at the stub', () => {
        home = newSandbox();

        seedSandbox(home, {}, 'http://127.0.0.1:1234/v1');

        const config = readConfig();
        expect(config.agents).toHaveLength(1);
        expect(config.agents[0].llm.baseURL).toBe('http://127.0.0.1:1234/v1');
        expect(config.agents[0].mode).toBe('agent');
        expect(config.agents[0].im.enabled).toBe(false);
        expect(config.ui.lang).toBe('en');
    });

    test('takes the identity and the mode from the scenario', () => {
        home = newSandbox();

        seedSandbox(home, {agentId: 'a1', agentName: 'Nemo', mode: 'chat', lang: 'zh'}, 'http://x/v1');

        const config = readConfig();
        expect(config.agents[0]).toMatchObject({id: 'a1', name: 'Nemo', mode: 'chat'});
        expect(config.ui.lang).toBe('zh');
    });

    test('lays down the files the case says already existed', () => {
        home = newSandbox();

        seedSandbox(home, {files: {'notes/todo.md': '- milk'}}, 'http://x/v1');

        expect(readFileSync(join(home, 'notes/todo.md'), 'utf8')).toBe('- milk');
    });

    test('lays down projects where the product looks for them', () => {
        home = newSandbox();

        seedSandbox(home, {projects: [{id: 'p1', name: 'Ship it'} as any]}, 'http://x/v1');

        expect(JSON.parse(readFileSync(join(home, '.projects/p1/project.json'), 'utf8')))
            .toMatchObject({id: 'p1', name: 'Ship it'});
    });

    test('removing a sandbox takes the whole tree with it', () => {
        const path = newSandbox();
        seedSandbox(path, {files: {'a/b/c.md': 'x'}}, 'http://x/v1');

        removeSandbox(path);

        expect(existsSync(path)).toBe(false);
    });
});
