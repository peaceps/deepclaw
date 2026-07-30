import {describe, expect, test, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    readDir: vi.fn<(dirPath: string) => {[key: string]: {dir: string, content: string}}>(),
    writeFile: vi.fn<(filePath: string, content: string) => string>(),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {readDir: mocks.readDir, writeFile: mocks.writeFile},
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    getLoopLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

const GLOBAL_DIR = '.memory';
const AGENT_DIR = '.agents/a1/memory';
const PROJECT_DIR = '.projects/p1/memory';
const CRON_DIR = '.cron/p1/memory';

type Folder = {[key: string]: {dir: string, content: string}};

function memoryDoc(
    front: {type?: string, name?: string, description?: string, datetime?: string},
    body: string = 'the memory body'
): string {
    const lines = Object.entries(front).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
    return `---\n${lines.join('\n')}\n---\n${body}`;
}

function folder(...docs: string[]): Folder {
    return Object.fromEntries(docs.map((content, index) => [`m${index}.md`, {dir: '', content}]));
}

/** Loaded memories are cached in module scope, so every test reloads the module with its own disk. */
async function loadManager(tree: {[dir: string]: Folder} = {}) {
    vi.resetModules();
    vi.resetAllMocks();
    mocks.readDir.mockImplementation((dirPath: string) => tree[dirPath] ?? {});
    mocks.writeFile.mockImplementation((filePath: string) => filePath);
    return (await import('./memory-manager')).MemoryManager;
}

/** Pays the transform of the module graph while the file loads, out of reach of a test timeout. */
await loadManager();

function indexLines(prompt: string, heading: string): string[] {
    const section = prompt.split(heading)[1] ?? '';
    return section.split('\n\n')[0]!.split('\n').filter(line => !!line.trim());
}

describe('getMemoryPrompt', () => {

    test('always explains when a memory should be saved', async () => {
        const manager = await loadManager();
        const prompt = manager.getMemoryPrompt('agent', 'a1');
        expect(prompt).toContain('When to save memories:');
        expect(prompt).toContain('You can get full content via read_memory_detail tool with scope and name.');
    });

    test('says nothing is stored yet when no memory exists', async () => {
        const manager = await loadManager();
        expect(manager.getMemoryPrompt('agent', 'a1')).toContain('(none on disk yet)');
    });

    test('lists the global memories shared by all agents', async () => {
        const manager = await loadManager({
            [GLOBAL_DIR]: folder(memoryDoc({type: 'preference', name: 'tabs', description: 'four spaces'})),
        });
        const prompt = manager.getMemoryPrompt('agent', 'a1');
        expect(prompt).toContain('## Global memories index (shared by all agents)');
        expect(prompt).toContain('Scope: global -> Type: preference -> Name: tabs -> Description: four spaces');
    });

    test('reads the agent memories from the folder of the agent', async () => {
        const manager = await loadManager({
            [AGENT_DIR]: folder(memoryDoc({type: 'rules', name: 'tone', description: 'be brief'})),
        });
        const prompt = manager.getMemoryPrompt('agent', 'a1');
        expect(mocks.readDir).toHaveBeenCalledWith(AGENT_DIR);
        expect(prompt).toContain('## Agent memories index (private to this agent)');
        expect(prompt).toContain('Scope: agent -> Type: rules -> Name: tone -> Description: be brief');
    });

    test('adds the project memories for a project loop', async () => {
        const manager = await loadManager({
            [PROJECT_DIR]: folder(memoryDoc({type: 'rules', name: 'deploy', description: 'friday is frozen'})),
        });
        const prompt = manager.getMemoryPrompt('project', 'a1', 'p1');
        expect(prompt).toContain('## project memories index (Focus on this project)');
        expect(prompt).toContain('Scope: project -> Type: rules -> Name: deploy');
    });

    test('calls the project memories a cron task for a cron loop', async () => {
        const manager = await loadManager({
            [CRON_DIR]: folder(memoryDoc({type: 'rules', name: 'report', description: 'send at nine'})),
        });
        const prompt = manager.getMemoryPrompt('cron', 'a1', 'p1');
        expect(mocks.readDir).toHaveBeenCalledWith(CRON_DIR);
        expect(prompt).toContain('## cron task memories index (Focus on this cron task)');
    });

    test('ignores a project id given to an agent loop', async () => {
        const manager = await loadManager({
            [PROJECT_DIR]: folder(memoryDoc({type: 'rules', name: 'deploy', description: 'friday is frozen'})),
        });
        const prompt = manager.getMemoryPrompt('agent', 'a1', 'p1');
        expect(mocks.readDir).not.toHaveBeenCalledWith(PROJECT_DIR);
        expect(prompt).not.toContain('memories index (Focus on this');
    });

    test('reads the memories of an agent from disk only once', async () => {
        const manager = await loadManager({
            [AGENT_DIR]: folder(memoryDoc({type: 'rules', name: 'tone', description: 'be brief'})),
        });
        manager.getMemoryPrompt('agent', 'a1');
        manager.getMemoryPrompt('agent', 'a1');
        expect(mocks.readDir.mock.calls.filter(call => call[0] === AGENT_DIR)).toHaveLength(1);
    });

    test('keeps the sections of the agents apart', async () => {
        const manager = await loadManager({
            [AGENT_DIR]: folder(memoryDoc({type: 'rules', name: 'tone', description: 'be brief'})),
        });
        manager.getMemoryPrompt('agent', 'a1');
        expect(manager.getMemoryPrompt('agent', 'a2')).not.toContain('Name: tone');
    });

    test('skips a memory whose frontmatter has no description', async () => {
        const manager = await loadManager({
            [GLOBAL_DIR]: folder(memoryDoc({type: 'rules', name: 'partial'})),
        });
        expect(manager.getMemoryPrompt('agent', 'a1')).toContain('(none on disk yet)');
    });

    test('skips a memory with a type nobody knows', async () => {
        const manager = await loadManager({
            [GLOBAL_DIR]: folder(memoryDoc({type: 'gossip', name: 'rumour', description: 'not a memory type'})),
        });
        expect(manager.getMemoryPrompt('agent', 'a1')).toContain('(none on disk yet)');
    });

    test('skips a file without any frontmatter', async () => {
        const manager = await loadManager({[GLOBAL_DIR]: folder('just some markdown')});
        expect(manager.getMemoryPrompt('agent', 'a1')).toContain('(none on disk yet)');
    });

    test('keeps the newest entry when two memories share a name', async () => {
        const manager = await loadManager({
            [GLOBAL_DIR]: folder(
                memoryDoc({type: 'rules', name: 'same', description: 'first', datetime: '2024-01-01'}),
                memoryDoc({type: 'rules', name: 'same', description: 'second', datetime: '2024-02-01'}),
            ),
        });
        const lines = indexLines(manager.getMemoryPrompt('agent', 'a1'), 'shared by all agents)\n');
        expect(lines).toEqual(['Scope: global -> Type: rules -> Name: same -> Description: second']);
    });

    test('sorts the index with the most recent memory first', async () => {
        const manager = await loadManager({
            [GLOBAL_DIR]: folder(
                memoryDoc({type: 'rules', name: 'older', description: 'a', datetime: '2024-01-01'}),
                memoryDoc({type: 'rules', name: 'newer', description: 'b', datetime: '2024-06-01'}),
            ),
        });
        const lines = indexLines(manager.getMemoryPrompt('agent', 'a1'), 'shared by all agents)\n');
        expect(lines.map(line => line.split('Name: ')[1])).toEqual([
            'newer -> Description: b', 'older -> Description: a',
        ]);
    });

    test('keeps at most one hundred memories in the index', async () => {
        const docs = Array.from(Array(101).keys()).map(index => memoryDoc({
            type: 'rules',
            name: `m${index}`,
            description: 'a memory',
            datetime: `2024-01-01T00:00:00.${String(index).padStart(3, '0')}Z`,
        }));
        const manager = await loadManager({[GLOBAL_DIR]: folder(...docs)});
        const lines = indexLines(manager.getMemoryPrompt('agent', 'a1'), 'shared by all agents)\n');
        expect(lines).toHaveLength(100);
        expect(lines[0]).toContain('Name: m100');
        expect(lines.join('\n')).not.toContain('Name: m0 ');
    });

    test('keeps exactly one hundred memories without dropping any', async () => {
        const docs = Array.from(Array(100).keys()).map(index => memoryDoc({
            type: 'rules', name: `m${index}`, description: 'a memory', datetime: '2024-01-01',
        }));
        const manager = await loadManager({[GLOBAL_DIR]: folder(...docs)});
        expect(indexLines(manager.getMemoryPrompt('agent', 'a1'), 'shared by all agents)\n')).toHaveLength(100);
    });

    test('cuts a long description at two hundred characters', async () => {
        const manager = await loadManager({
            [GLOBAL_DIR]: folder(memoryDoc({type: 'rules', name: 'long', description: 'x'.repeat(250)})),
        });
        const lines = indexLines(manager.getMemoryPrompt('agent', 'a1'), 'shared by all agents)\n');
        expect(lines[0]).toBe(`Scope: global -> Type: rules -> Name: long -> Description: ${'x'.repeat(200)}`);
    });
});

describe('getMemoryDetail', () => {

    test('answers with the body of a global memory', async () => {
        const manager = await loadManager({
            [GLOBAL_DIR]: folder(
                memoryDoc({type: 'rules', name: 'tabs', description: 'd'}, 'always use four spaces')
            ),
        });
        expect(manager.getMemoryDetail('tabs', 'agent').trim()).toBe('always use four spaces');
    });

    test('answers with the body of an agent memory', async () => {
        const manager = await loadManager({
            [AGENT_DIR]: folder(memoryDoc({type: 'rules', name: 'tone', description: 'd'}, 'be brief')),
        });
        expect(manager.getMemoryDetail('tone', 'agent', 'a1').trim()).toBe('be brief');
    });

    test('answers with the body of a project memory', async () => {
        const manager = await loadManager({
            [PROJECT_DIR]: folder(memoryDoc({type: 'rules', name: 'deploy', description: 'd'}, 'never on friday')),
        });
        expect(manager.getMemoryDetail('deploy', 'project', 'a1', 'p1').trim()).toBe('never on friday');
    });

    test('reports a missing memory for an unknown name', async () => {
        const manager = await loadManager();
        expect(manager.getMemoryDetail('ghost', 'agent', 'a1')).toBe('Memory not found.');
    });

    test('reports a missing memory when the project was never loaded', async () => {
        const manager = await loadManager();
        expect(manager.getMemoryDetail('deploy', 'agent', 'a1', 'p1')).toBe('Memory not found.');
    });

    test('falls back to the global memories when no agent is given', async () => {
        const manager = await loadManager({
            [GLOBAL_DIR]: folder(memoryDoc({type: 'rules', name: 'tabs', description: 'd'}, 'global body')),
        });
        expect(manager.getMemoryDetail('tabs', 'project', undefined, 'p1').trim()).toBe('global body');
    });
});

describe('addMemory', () => {

    const memory = {type: 'rules' as const, name: 'deploy', description: 'never on friday', content: 'the rule'};

    test('writes a global memory into the global folder', async () => {
        const manager = await loadManager();
        manager.addMemory(memory, 'agent');
        expect(mocks.writeFile).toHaveBeenCalledOnce();
        expect(mocks.writeFile.mock.calls[0]![0]).toBe('.memory/deploy.md');
        expect(mocks.writeFile.mock.calls[0]![1]).toContain('name: deploy');
    });

    test('writes an agent memory into the folder of the agent', async () => {
        const manager = await loadManager();
        manager.addMemory(memory, 'agent', 'a1');
        expect(mocks.writeFile.mock.calls[0]![0]).toBe('.agents/a1/memory/deploy.md');
    });

    test('writes a project memory into the folder of the project', async () => {
        const manager = await loadManager();
        manager.addMemory(memory, 'project', 'a1', 'p1');
        expect(mocks.writeFile.mock.calls[0]![0]).toBe('.projects/p1/memory/deploy.md');
    });

    test('writes a cron memory into the folder of the cron task', async () => {
        const manager = await loadManager();
        manager.addMemory(memory, 'cron', 'a1', 'p1');
        expect(mocks.writeFile.mock.calls[0]![0]).toBe('.cron/p1/memory/deploy.md');
    });

    test('does nothing when the scope was never loaded', async () => {
        const manager = await loadManager();
        manager.addMemory(memory, 'agent', 'a1', 'p1');
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    test('adds the new memory to the index of its scope', async () => {
        const manager = await loadManager();
        manager.addMemory(memory, 'project', 'a1', 'p1');
        expect(manager.getMemoryPrompt('project', 'a1', 'p1'))
            .toContain('Scope: project -> Type: rules -> Name: deploy -> Description: never on friday');
    });

    test('adds the new memory to the global index', async () => {
        const manager = await loadManager();
        manager.addMemory(memory, 'agent');
        expect(manager.getMemoryPrompt('agent', 'a1'))
            .toContain('Scope: global -> Type: rules -> Name: deploy');
    });

    test('makes the memory readable right away', async () => {
        const manager = await loadManager();
        manager.addMemory(memory, 'agent', 'a1');
        expect(manager.getMemoryDetail('deploy', 'agent', 'a1')).toBe('the rule');
    });

    test('replaces a memory stored under the same name', async () => {
        const manager = await loadManager();
        manager.addMemory(memory, 'agent', 'a1');
        manager.addMemory({...memory, content: 'the new rule', description: 'never at all'}, 'agent', 'a1');
        expect(manager.getMemoryDetail('deploy', 'agent', 'a1')).toBe('the new rule');
        const prompt = manager.getMemoryPrompt('agent', 'a1');
        expect(prompt).toContain('Description: never at all');
        expect(prompt).not.toContain('Description: never on friday');
    });

    test('stamps the memory with the time it was saved', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-05-04T03:02:01.000Z'));
        try {
            const manager = await loadManager();
            manager.addMemory(memory, 'agent', 'a1');
            expect(mocks.writeFile.mock.calls[0]![1]).toContain("datetime: '2024-05-04T03:02:01.000Z'");
        } finally {
            vi.useRealTimers();
        }
    });
});
