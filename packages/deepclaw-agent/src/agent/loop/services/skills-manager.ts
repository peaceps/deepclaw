import matter from 'gray-matter';
import { AgentMode } from '@deepclaw/config';
import { FileUtils, getLogger } from '@deepclaw/node-utils';
import { ALL_AGENT_MODES } from '../../definitions/tool-definitions';
import {
    SKILL_AGENT_JSON,
    SKILL_MD,
    SKILLS_DIR,
    SKILLS_LINK_DIR,
    SKILLS_LOCK_FILE,
} from '../../paths';

const logger = getLogger('SkillsManager');

export type SkillManifest = {
    name: string;
    description: string;
    dir: string;
}

type SkillDocument = {
    manifest: SkillManifest;
    body: string;
    agents?: string[];
    /** The modes the skill is offered in, unset meaning every one of them. */
    modes?: AgentMode[];
}

export type SkillInfo = {
    name: string;
    description: string;
    agents?: string[];
}

export class SkillsManager {
    private static skills: Map<string, SkillDocument>;

    /**
     * Reading a skill is held to the modes it is offered in, the same as listing it. A name is all
     * it takes to ask for one, and a name outlives the list it was read off: the run that asks is
     * as likely to have it from the user or from something it was told earlier. Handing the body
     * over anyway would walk a chat run through steps it has no tool to take.
     */
    public static getSkillContent(skillName: string, mode: AgentMode): string {
        if (!this.skills) {
            this.reloadSkills();
        }
        const skillDocument = this.skills.get(skillName);
        if (!skillDocument) {
            return `Error: Unknown skill: ${skillName}. Available skills: ${this.namesFor(mode).join(', ')}.`;
        }
        if (!this.offeredIn(skillDocument, mode)) {
            return `Error: Skill ${skillName} is not offered in ${mode} mode, only in `
                + `${skillDocument.modes!.join(' and ')} mode.`;
        }
        return `<skill name="${skillName}">\n${skillDocument.body}\n</skill>`;
    }

    /** Whether a skill is offered in a mode, a skill naming none of them being offered in all. */
    private static offeredIn(skill: SkillDocument, mode: AgentMode): boolean {
        return !skill.modes || skill.modes.includes(mode);
    }

    private static namesFor(mode: AgentMode): string[] {
        return Array.from(this.skills.values())
            .filter(skill => this.offeredIn(skill, mode))
            .map(skill => skill.manifest.name);
    }

    public static reloadSkills(): void {
        this.skills = new Map();
        const files = FileUtils.readDir(SKILLS_DIR, (fileName: string) => `${fileName}/${SKILL_MD}`);
        for (const {dir, content} of Object.values(files)) {
            this.parseSkillDocument(content, dir);
        }
    }

    public static createSkill(folder: string, files: {path: string, content: string}[]): void {
        if (!this.skills) {
            this.reloadSkills();
        }
        const skillDir = `${SKILLS_DIR}/${folder}`;
        if (FileUtils.exists(skillDir)) {
            throw new Error('Skill already exists.');
        }
        if (!files.some(file => file.path === SKILL_MD)) {
            throw new Error('Skill manifest file SKILL.md not found.');
        }
        for (const {path: filePath} of files) {
            if (!FileUtils.isPathInside(skillDir, filePath)) {
                throw new Error(`Invalid file path outside the skill folder: ${filePath}`);
            }
        }
        let manifest = null;
        try {
            for (const {path: filePath, content} of files) {
                if (filePath === SKILL_MD) {
                    manifest = content;
                }
                FileUtils.writeFile(`${skillDir}/${filePath}`, content);
            }
        } catch (e) {
            FileUtils.deleteDir(skillDir);
            throw new Error(`Failed to install skill. Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
        const registeredName = this.parseSkillDocument(manifest!, folder);
        if (!registeredName) {
            FileUtils.deleteDir(skillDir);
            throw new Error('Invalid SKILL.md: frontmatter must define both "name" and "description".');
        }
    }

    /**
     * Deletes an installed skill, named as the prompt lists it or by its folder. Removal goes
     * straight to the folder: the "npx skills remove" cli reports success while deleting nothing
     * whenever another coding agent it found on the machine still points at the skill, and every
     * agent that shares this folder is one of those, so its word is not worth a process spawn.
     *
     * Only a skill the manager read off the disk is deleted, and it is deleted by the folder it was
     * read from. A name is the one thing the prompt hands out, so a name is what comes back here,
     * and what comes back is not a path to follow anywhere.
     *
     * @returns whether a skill was found and deleted.
     */
    public static removeSkill(nameOrDir: string): boolean {
        if (!this.skills) {
            this.reloadSkills();
        }
        // A name the map does not know is worth one fresh look: a folder can go or arrive without
        // this process hearing of it, and answering out of an old reading tells the caller nothing.
        let known = this.findSkill(nameOrDir);
        if (!known) {
            this.reloadSkills();
            known = this.findSkill(nameOrDir);
        }
        if (!known) {
            return false;
        }
        const {name, dir} = known.manifest;
        // Read off the disk as the folder is, writing it back has to reach the same one: a name the
        // path sanitizer would rewrite would land on a sibling of it instead.
        const skillDir = `${SKILLS_DIR}/${dir}`;
        if (dir !== FileUtils.sanitizeFileName(dir) || !FileUtils.isPathInside(SKILLS_DIR, skillDir)) {
            return false;
        }
        // A skill is read from this folder, so this folder is taken for the skill itself. An
        // installer that put the skill somewhere else and linked it here leaves that copy behind,
        // since only a link of ours is followed up on: say where it led, or nobody could ever tell.
        const target = FileUtils.linkTarget(skillDir);
        if (target) {
            logger.warn(`Skill ${name} is a link to ${target}, only the link here is removed.`);
        }
        FileUtils.deleteDir(skillDir);
        this.removeCliLeftovers(dir, name);
        this.reloadSkills();
        return true;
    }

    private static findSkill(nameOrDir: string): SkillDocument | undefined {
        return this.skills.get(nameOrDir)
            ?? Array.from(this.skills.values()).find(skill => skill.manifest.dir === nameOrDir);
    }

    /**
     * The cli behind download_skill links an installed skill into "skills/<name>" for any agent
     * that reads a folder of that name, and lists what it installs in "skills-lock.json" without
     * ever taking an entry out again. Both are cleaned best effort: a skill that never went through
     * the cli wrote neither, and a leftover entry keeps telling the cli the skill is installed.
     *
     * The lock is keyed by the name the cli read, the folder is that name sanitized, so the two
     * part ways for a name that was not written as a folder name to begin with. Both are dropped.
     *
     * Only a link is dropped there, never a folder. That name sits outside the one folder deepclaw
     * owns, and a data root is any folder somebody points deepclaw at: a real "skills" folder in it
     * is somebody's own, and holding a skill of the same name is no reason to take it.
     *
     * The lock is held to the same rule, the file being somebody's own for the same reason: an
     * entry is dropped only once nothing of that name is left installed here. A folder that was
     * spared for being nobody's link keeps its entry, which is the record of that folder.
     */
    private static removeCliLeftovers(dir: string, name: string): void {
        try {
            const link = `${SKILLS_LINK_DIR}/${dir}`;
            if (FileUtils.isLink(link)) {
                FileUtils.deleteDir(link);
            }
        } catch {
            // The link is a leftover, failing to drop it costs nothing.
        }
        try {
            if (!FileUtils.exists(SKILLS_LOCK_FILE)) {
                return;
            }
            const lock = JSON.parse(FileUtils.readFile(SKILLS_LOCK_FILE)) as
                {skills?: Record<string, unknown>};
            const listed = [dir, name].filter(key => !!lock.skills && key in lock.skills)
                .filter(key => !this.stillInstalled(key));
            if (listed.length === 0) {
                return;
            }
            listed.forEach(key => delete lock.skills![key]);
            FileUtils.writeFile(SKILLS_LOCK_FILE, JSON.stringify(lock, null, 2));
        } catch {
            // An unreadable lock file is the cli's problem, not ours.
        }
    }

    /** Whether either folder a lock entry could stand for is still there to be read as a skill. */
    private static stillInstalled(key: string): boolean {
        return FileUtils.exists(`${SKILLS_DIR}/${key}`) || FileUtils.exists(`${SKILLS_LINK_DIR}/${key}`);
    }

    private static parseSkillDocument(fileContent: string, dir: string): string | undefined {
        const {data, content} = matter(fileContent.replace(/\r\n/g, '\n'));
        if (!data['name'] || !data['description']) {
            return undefined;
        }

        const skill: SkillDocument = {
            manifest: {
                name: data['name'],
                description: data['description'],
                dir,
            },
            body: content,
            modes: this.readModes(data['modes']),
        };

        try {
            const agentFile = `${SKILLS_DIR}/${dir}/${SKILL_AGENT_JSON}`;
            if (FileUtils.exists(agentFile)) {
                const agents = FileUtils.readFile(agentFile);
                skill.agents = JSON.parse(agents) as string[];
            }
        } catch {
            skill.agents = undefined;
        }

        this.skills.set(skill.manifest.name, skill);
        return skill.manifest.name;
    }

    /**
     * The modes a skill declares it is any use in. A skill made of shell commands is dead weight in
     * chat mode, where no tool runs one, and offering it there buys nothing but a run that promises
     * work it cannot do.
     *
     * Nearly every skill is somebody else's and says nothing about deepclaw's modes, so saying
     * nothing has to keep meaning what it meant before: offered everywhere. Only a list naming a
     * mode we know narrows anything, and junk in that field is read as no list at all.
     */
    private static readModes(declared: unknown): AgentMode[] | undefined {
        if (!Array.isArray(declared)) {
            return undefined;
        }
        const modes = declared.filter(
            (mode): mode is AgentMode => ALL_AGENT_MODES.includes(mode as AgentMode)
        );
        return modes.length > 0 ? modes : undefined;
    }

    public static generateSkillPrompt(agentId: string, mode: AgentMode): string {
        return `You have below skills installed:
${this.getAvailableSkillsPrompt(agentId, mode)}

When user ask for some skill, first check from above available skills.
If not found, use search_online_skills to search from public networks.
load_skill_details is a local function that hands you the whole text of a skill. Read a skill with
it, and never go looking for skill files on disk: that costs the user a permission prompt and finds
nothing this tool would not have given you. This governs finding a skill, not following one, so run
whatever commands a skill you have loaded tells you to run.
`;
    }

    public static getAvailableSkillsPrompt(agentId: string, mode: AgentMode): string {
        if (!this.skills) {
            this.reloadSkills();
        }
        const skills = Array.from(this.skills.values()).filter(skill =>
            (!skill.agents || skill.agents.includes(agentId)) && this.offeredIn(skill, mode)
        ).map(skill => skill.manifest).reduce((acc, skill) => acc + `- ${skill.name}: ${skill.description}\n`, '');

        return skills.length === 0 ? '(no skills available)' : skills;
    }

    public static getSkillList(): SkillInfo[] {
        if (!this.skills) {
            this.reloadSkills();
        }
        return Array.from(this.skills.values()).map(skill => ({
            name: skill.manifest.name,
            description: skill.manifest.description,
            agents: skill.agents,
        }));
    }

    public static updateSkillAgents(name: string, agentIds?: string[]): void {
        if (!this.skills) {
            this.reloadSkills();
        }
        const skill = this.skills.get(name);
        if (skill) {
            if (!agentIds) {
                FileUtils.deleteFile(`${SKILLS_DIR}/${skill.manifest.dir}/${SKILL_AGENT_JSON}`);
                skill.agents = undefined;
            } else {
                FileUtils.writeFile(
                    `${SKILLS_DIR}/${skill.manifest.dir}/${SKILL_AGENT_JSON}`,
                    JSON.stringify(agentIds, null, 2)
                );
                skill.agents = agentIds;
            }
        }
    }
}
