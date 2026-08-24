import {describe, expect, test, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    readDir: vi.fn<(dirPath: string) => {[key: string]: {dir: string, content: string}}>(),
    exists: vi.fn<(filePath: string) => boolean>(),
    readFile: vi.fn<(filePath: string) => string>(),
    writeFile: vi.fn<(filePath: string, content: string) => string>(),
    deleteFile: vi.fn<(filePath: string) => void>(),
    deleteDir: vi.fn<(filePath: string) => void>(),
    isPathInside: vi.fn<(baseDir: string, targetPath: string) => boolean>(),
    isLink: vi.fn<(filePath: string) => boolean>(),
    linkTarget: vi.fn<(filePath: string) => string | null>(),
    warn: vi.fn<(message: string) => void>(),
}));

vi.mock('@deepclaw/node-utils', async (importOriginal) => {
    const original = await importOriginal<typeof import('@deepclaw/node-utils')>();
    return {
        ...original,
        FileUtils: {
            readDir: mocks.readDir,
            exists: mocks.exists,
            readFile: mocks.readFile,
            writeFile: mocks.writeFile,
            deleteFile: mocks.deleteFile,
            deleteDir: mocks.deleteDir,
            isPathInside: mocks.isPathInside,
            isLink: mocks.isLink,
            linkTarget: mocks.linkTarget,
            // Naming a path is what the real one does and no disk is touched doing it, so the
            // question of which name lands where is answered here as it is answered on disk.
            sanitizeFileName: (name: string) => original.FileUtils.sanitizeFileName(name),
        },
        getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn()}),
        getLoopLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    };
});

const AGENT_JSON = /^\.agents\/skills\/([^/]+)\/agent\.json$/;

type SkillFolder = {manifest: string, agents?: string};

function manifest(name: string, description: string, body: string = 'do the thing'): string {
    return `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;
}

/** A manifest of a skill that narrows itself to some modes, written as yaml has it. */
function modal(name: string, description: string, modes: string): string {
    return `---\nname: ${name}\ndescription: ${description}\nmodes: ${modes}\n---\ndo the thing`;
}

/** The skill index lives in module scope, so every test reloads the module with its own disk. */
async function loadManager(folders: Record<string, SkillFolder> = {}) {
    vi.resetModules();
    vi.resetAllMocks();
    mocks.readDir.mockImplementation(() => Object.fromEntries(
        Object.entries(folders).map(([dir, folder]) => [dir, {dir, content: folder.manifest}])
    ));
    mocks.exists.mockImplementation((filePath: string) => {
        const folder = AGENT_JSON.exec(filePath)?.[1];
        return !!folder && folders[folder]?.agents !== undefined;
    });
    mocks.readFile.mockImplementation(
        (filePath: string) => folders[AGENT_JSON.exec(filePath)?.[1] ?? '']?.agents ?? ''
    );
    mocks.writeFile.mockImplementation((filePath: string) => filePath);
    mocks.isPathInside.mockReturnValue(true);
    // What the cli leaves beside the skills folder is a link, which is the only thing taken there.
    mocks.isLink.mockReturnValue(true);
    // The skill folder itself holds the skill, an install that only linked it there is the odd one.
    mocks.linkTarget.mockReturnValue(null);
    return (await import('./skills-manager')).SkillsManager;
}

/** Pays the transform of the module graph while the file loads, out of reach of a test timeout. */
await loadManager();

describe('reloadSkills', () => {

    test('indexes every folder whose manifest declares a name and a description', async () => {
        const manager = await loadManager({
            pptx: {manifest: manifest('pptx', 'build slide decks')},
            video: {manifest: manifest('video', 'generate videos')},
        });
        manager.reloadSkills();
        expect(manager.getSkillList().map(skill => skill.name)).toEqual(['pptx', 'video']);
    });

    test('reads the skill folder with no skill installed', async () => {
        const manager = await loadManager();
        manager.reloadSkills();
        expect(manager.getSkillList()).toEqual([]);
        expect(mocks.readDir).toHaveBeenCalledWith('.agents/skills', expect.any(Function));
    });

    test('skips a manifest without a description', async () => {
        const manager = await loadManager({
            broken: {manifest: '---\nname: broken\n---\nno description here'},
            ok: {manifest: manifest('ok', 'fine')},
        });
        manager.reloadSkills();
        expect(manager.getSkillList().map(skill => skill.name)).toEqual(['ok']);
    });

    test('skips a manifest without a name', async () => {
        const manager = await loadManager({broken: {manifest: '---\ndescription: nameless\n---\nbody'}});
        manager.reloadSkills();
        expect(manager.getSkillList()).toEqual([]);
    });

    test('reads a manifest written with windows line endings', async () => {
        const manager = await loadManager({
            pptx: {manifest: '---\r\nname: pptx\r\ndescription: build slide decks\r\n---\r\nbody'},
        });
        manager.reloadSkills();
        expect(manager.getSkillList()).toEqual([
            {name: 'pptx', description: 'build slide decks', agents: undefined},
        ]);
    });

    test('attaches the agent allow list stored next to the skill', async () => {
        const manager = await loadManager({
            pptx: {manifest: manifest('pptx', 'build slide decks'), agents: '["a1","a2"]'},
        });
        manager.reloadSkills();
        expect(manager.getSkillList()[0]!.agents).toEqual(['a1', 'a2']);
    });

    test('leaves the allow list open when the skill has no agent file', async () => {
        const manager = await loadManager({pptx: {manifest: manifest('pptx', 'build slide decks')}});
        manager.reloadSkills();
        expect(manager.getSkillList()[0]!.agents).toBeUndefined();
    });

    test('leaves the allow list open when the agent file is not valid json', async () => {
        const manager = await loadManager({
            pptx: {manifest: manifest('pptx', 'build slide decks'), agents: '[a1'},
        });
        manager.reloadSkills();
        expect(manager.getSkillList()[0]!.agents).toBeUndefined();
    });

    test('forgets a skill that disappeared from disk', async () => {
        const manager = await loadManager({pptx: {manifest: manifest('pptx', 'build slide decks')}});
        manager.reloadSkills();
        mocks.readDir.mockReturnValue({});
        manager.reloadSkills();
        expect(manager.getSkillList()).toEqual([]);
    });
});

describe('getSkillContent', () => {

    test('loads the skills the first time a skill is asked for', async () => {
        const manager = await loadManager({pptx: {manifest: manifest('pptx', 'build slide decks')}});
        expect(manager.getSkillContent('pptx', 'agent'))
            .toBe('<skill name="pptx">\ndo the thing\n</skill>');
        expect(mocks.readDir).toHaveBeenCalledOnce();
    });

    test('reports the installed skills when the name is unknown', async () => {
        const manager = await loadManager({
            pptx: {manifest: manifest('pptx', 'build slide decks')},
            video: {manifest: manifest('video', 'generate videos')},
        });
        expect(manager.getSkillContent('ghost', 'agent'))
            .toBe('Error: Unknown skill: ghost. Available skills: pptx, video.');
    });

    test('reports an empty skill list when nothing is installed', async () => {
        const manager = await loadManager();
        expect(manager.getSkillContent('ghost', 'agent'))
            .toBe('Error: Unknown skill: ghost. Available skills: .');
    });

    // A name outlives the list it was read off, so the list is not the whole of the gate.
    test('refuses the body of a skill the mode is not offered', async () => {
        const manager = await loadManager({
            browser: {manifest: modal('browser', 'drives a browser', '[agent]')},
        });
        expect(manager.getSkillContent('browser', 'chat'))
            .toBe('Error: Skill browser is not offered in chat mode, only in agent mode.');
        expect(manager.getSkillContent('browser', 'agent')).toContain('<skill name="browser">');
    });

    test('leaves a skill the mode is not offered out of the list of what there is', async () => {
        const manager = await loadManager({
            browser: {manifest: modal('browser', 'drives a browser', '[agent]')},
            pptx: {manifest: manifest('pptx', 'build slide decks')},
        });
        expect(manager.getSkillContent('ghost', 'chat'))
            .toBe('Error: Unknown skill: ghost. Available skills: pptx.');
    });
});

describe('getAvailableSkillsPrompt', () => {

    test('lists a skill that is not restricted to any agent', async () => {
        const manager = await loadManager({pptx: {manifest: manifest('pptx', 'build slide decks')}});
        expect(manager.getAvailableSkillsPrompt('a1', 'agent')).toBe('- pptx: build slide decks\n');
    });

    test('lists a skill the agent is allowed to use', async () => {
        const manager = await loadManager({
            pptx: {manifest: manifest('pptx', 'build slide decks'), agents: '["a1"]'},
        });
        expect(manager.getAvailableSkillsPrompt('a1', 'agent')).toBe('- pptx: build slide decks\n');
    });

    test('hides a skill reserved for other agents', async () => {
        const manager = await loadManager({
            pptx: {manifest: manifest('pptx', 'build slide decks'), agents: '["a2"]'},
            video: {manifest: manifest('video', 'generate videos')},
        });
        expect(manager.getAvailableSkillsPrompt('a1', 'agent')).toBe('- video: generate videos\n');
    });

    test('answers with a placeholder when the agent may use nothing', async () => {
        const manager = await loadManager({
            pptx: {manifest: manifest('pptx', 'build slide decks'), agents: '[]'},
        });
        expect(manager.getAvailableSkillsPrompt('a1', 'agent')).toBe('(no skills available)');
    });

    test('answers with a placeholder when no skill is installed', async () => {
        const manager = await loadManager();
        expect(manager.getAvailableSkillsPrompt('a1', 'agent')).toBe('(no skills available)');
    });

    test('hides a skill reserved for agent mode from a chat run', async () => {
        const manager = await loadManager({
            browser: {manifest: modal('browser', 'drives a browser', '[agent]')},
            pptx: {manifest: manifest('pptx', 'build slide decks')},
        });
        expect(manager.getAvailableSkillsPrompt('a1', 'chat')).toBe('- pptx: build slide decks\n');
        expect(manager.getAvailableSkillsPrompt('a1', 'agent'))
            .toBe('- browser: drives a browser\n- pptx: build slide decks\n');
    });

    test('offers a skill naming both modes in either of them', async () => {
        const manager = await loadManager({
            notes: {manifest: modal('notes', 'writes notes', '[agent, chat]')},
        });
        expect(manager.getAvailableSkillsPrompt('a1', 'chat')).toBe('- notes: writes notes\n');
        expect(manager.getAvailableSkillsPrompt('a1', 'agent')).toBe('- notes: writes notes\n');
    });

    test('offers a skill that names no mode everywhere, as skills of others do', async () => {
        const manager = await loadManager({pptx: {manifest: manifest('pptx', 'build slide decks')}});
        expect(manager.getAvailableSkillsPrompt('a1', 'chat')).toBe('- pptx: build slide decks\n');
    });

    test('reads a mode list of nothing we know as no list at all', async () => {
        const manager = await loadManager({
            pptx: {manifest: modal('pptx', 'build slide decks', '[headless, batch]')},
        });
        expect(manager.getAvailableSkillsPrompt('a1', 'chat')).toBe('- pptx: build slide decks\n');
    });

    test('keeps the modes it knows out of a list that also names junk', async () => {
        const manager = await loadManager({
            pptx: {manifest: modal('pptx', 'build slide decks', '[agent, headless]')},
        });
        expect(manager.getAvailableSkillsPrompt('a1', 'chat')).toBe('(no skills available)');
        expect(manager.getAvailableSkillsPrompt('a1', 'agent')).toBe('- pptx: build slide decks\n');
    });
});

describe('generateSkillPrompt', () => {

    test('embeds the skills the agent may use into the instructions', async () => {
        const manager = await loadManager({pptx: {manifest: manifest('pptx', 'build slide decks')}});
        const prompt = manager.generateSkillPrompt('a1', 'agent');
        expect(prompt).toContain('You have below skills installed:\n- pptx: build slide decks');
        expect(prompt).toContain('load_skill_details');
    });

    test('still explains the skill tools when nothing is installed', async () => {
        const manager = await loadManager();
        expect(manager.generateSkillPrompt('a1', 'agent')).toContain('(no skills available)');
    });
});

describe('updateSkillAgents', () => {

    test('writes the allow list next to the skill and remembers it', async () => {
        const manager = await loadManager({pptx: {manifest: manifest('pptx', 'build slide decks')}});
        manager.updateSkillAgents('pptx', ['a1']);
        expect(mocks.writeFile).toHaveBeenCalledExactlyOnceWith(
            '.agents/skills/pptx/agent.json', JSON.stringify(['a1'], null, 2)
        );
        expect(manager.getSkillList()[0]!.agents).toEqual(['a1']);
    });

    test('deletes the allow list when it is cleared', async () => {
        const manager = await loadManager({
            pptx: {manifest: manifest('pptx', 'build slide decks'), agents: '["a1"]'},
        });
        manager.updateSkillAgents('pptx');
        expect(mocks.deleteFile).toHaveBeenCalledExactlyOnceWith('.agents/skills/pptx/agent.json');
        expect(manager.getSkillList()[0]!.agents).toBeUndefined();
    });

    test('stores an empty allow list as a file that hides the skill', async () => {
        const manager = await loadManager({pptx: {manifest: manifest('pptx', 'build slide decks')}});
        manager.updateSkillAgents('pptx', []);
        expect(mocks.writeFile).toHaveBeenCalledOnce();
        expect(manager.getAvailableSkillsPrompt('a1', 'agent')).toBe('(no skills available)');
    });

    test('does nothing for an unknown skill', async () => {
        const manager = await loadManager({pptx: {manifest: manifest('pptx', 'build slide decks')}});
        manager.updateSkillAgents('ghost', ['a1']);
        expect(mocks.writeFile).not.toHaveBeenCalled();
        expect(mocks.deleteFile).not.toHaveBeenCalled();
    });
});

describe('createSkill', () => {

    test('refuses a folder that already exists', async () => {
        const manager = await loadManager();
        mocks.exists.mockReturnValue(true);
        expect(() => manager.createSkill('pptx', [{path: 'SKILL.md', content: manifest('pptx', 'decks')}]))
            .toThrow('Skill already exists.');
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    test('refuses a skill without a manifest file', async () => {
        const manager = await loadManager();
        expect(() => manager.createSkill('pptx', [{path: 'readme.md', content: 'hello'}]))
            .toThrow('Skill manifest file SKILL.md not found.');
    });

    test('refuses a file that escapes the skill folder', async () => {
        const manager = await loadManager();
        mocks.isPathInside.mockReturnValue(false);
        expect(() => manager.createSkill('pptx', [{path: 'SKILL.md', content: manifest('pptx', 'decks')}]))
            .toThrow('Invalid file path outside the skill folder: SKILL.md');
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    test('writes every file and registers the new skill', async () => {
        const manager = await loadManager();
        manager.createSkill('pptx', [
            {path: 'SKILL.md', content: manifest('pptx', 'build slide decks')},
            {path: 'assets/template.txt', content: 'template'},
        ]);
        expect(mocks.writeFile.mock.calls.map(call => call[0])).toEqual([
            '.agents/skills/pptx/SKILL.md', '.agents/skills/pptx/assets/template.txt',
        ]);
        expect(manager.getSkillContent('pptx', 'agent')).toContain('<skill name="pptx">');
    });

    test('rolls back the folder when a file cannot be written', async () => {
        const manager = await loadManager();
        mocks.writeFile.mockImplementation(() => {
            throw new Error('disk full');
        });
        expect(() => manager.createSkill('pptx', [{path: 'SKILL.md', content: manifest('pptx', 'decks')}]))
            .toThrow('Failed to install skill. Error: disk full');
        expect(mocks.deleteDir).toHaveBeenCalledExactlyOnceWith('.agents/skills/pptx');
    });

    test('rolls back the folder when the manifest has no name', async () => {
        const manager = await loadManager();
        expect(() => manager.createSkill('pptx', [{path: 'SKILL.md', content: '---\ndescription: d\n---\nbody'}]))
            .toThrow('Invalid SKILL.md: frontmatter must define both "name" and "description".');
        expect(mocks.deleteDir).toHaveBeenCalledExactlyOnceWith('.agents/skills/pptx');
    });

    test('registers the skill under the name from the manifest, not the folder', async () => {
        const manager = await loadManager();
        manager.createSkill('pptx-folder', [
            {path: 'SKILL.md', content: manifest('pptx', 'build slide decks')},
        ]);
        expect(manager.getSkillList().map(skill => skill.name)).toEqual(['pptx']);
    });
});

describe('removeSkill', () => {

    function lockOf(skills: Record<string, unknown>): (filePath: string) => string {
        return (filePath: string) => filePath === 'skills-lock.json'
            ? JSON.stringify({version: 1, skills})
            : '';
    }

    /**
     * The "npx skills" cli links an install into "skills/<name>" and lists it in its lock file,
     * then refuses to delete the folder while that link stands (while still reporting success).
     * Removal takes the leftovers with the folder.
     */
    test('deletes the folder, the cli link and the lock entry', async () => {
        const manager = await loadManager({pptx: {manifest: manifest('pptx', 'build slide decks')}});
        mocks.exists.mockImplementation((filePath: string) => filePath === 'skills-lock.json');
        mocks.readFile.mockImplementation(lockOf({pptx: {source: 'org/repo'}, other: {source: 'org/repo'}}));

        expect(manager.removeSkill('pptx')).toBe(true);

        // The folder goes first: what the lock still stands for is read off the disk after it.
        expect(mocks.deleteDir.mock.calls.map(call => call[0])).toEqual(['.agents/skills/pptx', 'skills/pptx']);
        const writtenLock = JSON.parse(mocks.writeFile.mock.calls[0]![1] as string);
        expect(writtenLock.skills).toEqual({other: {source: 'org/repo'}});
    });

    /**
     * The cli keys its lock by the name it read and names the folder by that name sanitized, so a
     * name that was not written as a folder name leaves an entry under neither the one nor the other.
     */
    test('drops a lock entry keyed by the name rather than the folder', async () => {
        const manager = await loadManager({
            'convex-best-practices': {manifest: manifest('Convex Best Practices', 'convex rules')},
        });
        mocks.exists.mockImplementation((filePath: string) => filePath === 'skills-lock.json');
        mocks.readFile.mockImplementation(lockOf({
            'Convex Best Practices': {source: 'org/repo'}, other: {source: 'org/repo'},
        }));

        expect(manager.removeSkill('Convex Best Practices')).toBe(true);

        expect(mocks.deleteDir.mock.calls.map(call => call[0]))
            .toEqual(['.agents/skills/convex-best-practices', 'skills/convex-best-practices']);
        expect(JSON.parse(mocks.writeFile.mock.calls[0]![1] as string).skills)
            .toEqual({other: {source: 'org/repo'}});
    });

    test('writes no lock file for a skill the cli never listed', async () => {
        const manager = await loadManager({pptx: {manifest: manifest('pptx', 'build slide decks')}});
        mocks.exists.mockReturnValue(false);

        expect(manager.removeSkill('pptx')).toBe(true);

        expect(mocks.deleteDir.mock.calls.map(call => call[0])).toEqual(['.agents/skills/pptx', 'skills/pptx']);
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    test('finds the folder through the manifest name when they differ', async () => {
        const manager = await loadManager({
            'pptx-folder': {manifest: manifest('pptx', 'build slide decks')},
        });
        mocks.exists.mockReturnValue(false);

        expect(manager.removeSkill('pptx')).toBe(true);

        expect(mocks.deleteDir.mock.calls.map(call => call[0]))
            .toEqual(['.agents/skills/pptx-folder', 'skills/pptx-folder']);
    });

    test('takes a skill named by its folder as readily as by its name', async () => {
        const manager = await loadManager({
            'pptx-folder': {manifest: manifest('pptx', 'build slide decks')},
        });
        mocks.exists.mockReturnValue(false);

        expect(manager.removeSkill('pptx-folder')).toBe(true);

        expect(mocks.deleteDir.mock.calls.map(call => call[0]))
            .toEqual(['.agents/skills/pptx-folder', 'skills/pptx-folder']);
    });

    /** The disk can lose or gain a folder without this process hearing of it. */
    test('reads the folder again before saying it knows no such skill', async () => {
        const manager = await loadManager({pptx: {manifest: manifest('pptx', 'build slide decks')}});
        manager.getSkillList();
        const readsBefore = mocks.readDir.mock.calls.length;

        expect(manager.removeSkill('ghost')).toBe(false);

        expect(mocks.readDir.mock.calls.length).toBe(readsBefore + 1);
        expect(mocks.deleteDir).not.toHaveBeenCalled();
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    /** A name is a name here, so nothing is followed anywhere: only a listed skill is deleted. */
    test('deletes nothing for a name that reads as a path', async () => {
        const manager = await loadManager({pptx: {manifest: manifest('pptx', 'build slide decks')}});
        mocks.exists.mockReturnValue(true);

        expect(manager.removeSkill('../escape')).toBe(false);
        expect(manager.removeSkill('.agents/skills/pptx')).toBe(false);

        expect(mocks.deleteDir).not.toHaveBeenCalled();
    });

    /**
     * The bare "skills" folder is outside the one folder deepclaw owns, and a data root is any
     * folder it was pointed at: a real folder of that name there belongs to whoever made it.
     */
    test('leaves a real folder beside the skills folder alone', async () => {
        const manager = await loadManager({pptx: {manifest: manifest('pptx', 'build slide decks')}});
        mocks.exists.mockReturnValue(false);
        mocks.isLink.mockReturnValue(false);

        expect(manager.removeSkill('pptx')).toBe(true);

        expect(mocks.deleteDir).toHaveBeenCalledExactlyOnceWith('.agents/skills/pptx');
    });

    /** Deleting under a name written otherwise than it is read would land on a sibling of it. */
    test('refuses a folder the path sanitizer would rewrite', async () => {
        const manager = await loadManager({'odd@folder': {manifest: manifest('odd', 'odd one')}});
        mocks.exists.mockReturnValue(false);

        expect(manager.removeSkill('odd')).toBe(false);

        expect(mocks.deleteDir).not.toHaveBeenCalled();
    });

    test('leaves a broken lock file alone', async () => {
        const manager = await loadManager({pptx: {manifest: manifest('pptx', 'build slide decks')}});
        mocks.exists.mockImplementation((filePath: string) => filePath === 'skills-lock.json');
        mocks.readFile.mockReturnValue('not json');

        expect(manager.removeSkill('pptx')).toBe(true);

        expect(mocks.deleteDir.mock.calls.map(call => call[0])).toEqual(['.agents/skills/pptx', 'skills/pptx']);
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    /**
     * A folder spared for being nobody's link is still installed as far as anything reading the
     * lock can tell, and the entry is that reader's record of it. The one is left with the other.
     */
    test('keeps the lock entry of a real folder it left standing', async () => {
        const manager = await loadManager({pptx: {manifest: manifest('pptx', 'build slide decks')}});
        mocks.isLink.mockReturnValue(false);
        mocks.exists.mockImplementation(
            (filePath: string) => filePath === 'skills-lock.json' || filePath === 'skills/pptx'
        );
        mocks.readFile.mockImplementation(lockOf({pptx: {source: 'org/repo'}}));

        expect(manager.removeSkill('pptx')).toBe(true);

        expect(mocks.deleteDir).toHaveBeenCalledExactlyOnceWith('.agents/skills/pptx');
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    /**
     * The cli can install a skill elsewhere and only link it here, and the copy it links to is
     * nobody's to delete from here. Nothing else would say where the skill of that name went.
     */
    test('says where a skill folder led when it was only a link', async () => {
        const manager = await loadManager({pptx: {manifest: manifest('pptx', 'build slide decks')}});
        mocks.exists.mockReturnValue(false);
        mocks.linkTarget.mockImplementation(
            (filePath: string) => filePath === '.agents/skills/pptx' ? '/elsewhere/pptx' : null
        );

        expect(manager.removeSkill('pptx')).toBe(true);

        expect(mocks.warn).toHaveBeenCalledWith(
            'Skill pptx is a link to /elsewhere/pptx, only the link here is removed.'
        );
    });

    test('says nothing of a skill folder that holds the skill itself', async () => {
        const manager = await loadManager({pptx: {manifest: manifest('pptx', 'build slide decks')}});
        mocks.exists.mockReturnValue(false);

        expect(manager.removeSkill('pptx')).toBe(true);

        expect(mocks.warn).not.toHaveBeenCalled();
    });
});
