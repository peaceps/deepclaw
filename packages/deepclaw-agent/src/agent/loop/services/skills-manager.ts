import matter from 'gray-matter';
import { FileUtils } from '@deepclaw/node-utils';
import { SKILL_MD, SKILLS_DIR } from '../../paths';

type SkillManifest = {
    name: string;
    description: string;
    dir: string;
}

type SkillDocument = {
    manifest: SkillManifest;
    body: string;
}

export class SkillsManager {
    private static skills: Map<string, SkillDocument>;
    private static skillPrompt: string;

    public static getSkillContent(skillName: string): string {
        if (!this.skills) {
            this.loadSkills();
        }
        const skillDocument = this.skills.get(skillName);
        if (!skillDocument) {
            return `Error: Unknown skill: ${skillName}. Available skills: ${Array.from(this.skills.keys()).join(', ')}.`;
        }
        return `<skill name="${skillName}">\n${skillDocument.body}\n</skill>`;
    }

    private static loadSkills(): void {
        this.skills = new Map();
        const files = FileUtils.readDir(SKILLS_DIR, (fileName: string) => `${fileName}/${SKILL_MD}`);
        for (const {dir, content} of Object.values(files)) {
            this.parseSkillDocument(content, dir);
        }
        this.skillPrompt = this.generateSkillPrompt();
    }

    public static reloadSkills(): string {
        this.loadSkills();
        return this.getAvailableSkills();
    }

    public static deleteSkill(name: string): void {
        if (!this.skills.has(name)) {
            return;
        }
        FileUtils.deleteDir(`${SKILLS_DIR}/${this.skills.get(name)!.manifest.dir}`);
        this.skills.delete(name);
        this.skillPrompt = this.generateSkillPrompt();
    }

    public static installSkill(folder: string, files: {path: string, content: string}[]): void {
        if (!this.skills) {
            this.loadSkills();
        }
        const skillDir = `${SKILLS_DIR}/${folder}`;
        if (FileUtils.exists(skillDir)) {
            throw new Error('Skill already exists.');
        }
        if (!files.some(file => file.path === SKILL_MD)) {
            throw new Error('Skill manifest file SKILL.md not found.');
        }
        let manifest = null;
        try {
            for (const {path, content} of files) {
                if (path === SKILL_MD) {
                    manifest = content;
                }
                FileUtils.writeFile(`${skillDir}/${path}`, content);
            }
        } catch (e) {
            FileUtils.deleteDir(skillDir);
            throw new Error(`Failed to install skill. Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
        this.parseSkillDocument(manifest!, folder);
        this.skillPrompt = this.generateSkillPrompt();
    }

    private static parseSkillDocument(fileContent: string, dir: string): void {
        const {data, content} = matter(fileContent.replace(/\r\n/g, '\n'));
        if (!data['name'] || !data['description']) {
            return;
        }

        const skill = {
            manifest: {
                name: data['name'],
                description: data['description'],
                dir,
            },
            body: content,
        };
        this.skills.set(skill.manifest.name, skill);
    }

    public static getSkillPrompt(): string {
        if (!this.skills) {
            this.loadSkills();
        }
        return this.skillPrompt;
    }

    private static generateSkillPrompt(): string {
        return `MCP server is not installed, do not use mcp_call.
IMPORTANT: You can only use local function calls, no mcp_calls.

Below available skills are not tools nor MCP tools, they cannot be used directly,
load_skill tool is a local function to get the detailed information of skills.
You always need to use load_skill tool with function_call first.

When user ask for some skill, first check from below available skills.
If not found, use find-skills skill to search from public skills.

Skills available:
${SkillsManager.getAvailableSkills()}`
    }

    private static getAvailableSkills(): string {
        if (!this.skills || this.skills.size === 0) {
            return '(no skills available)';
        }
        return Array.from(this.skills.values()).map(skill => skill.manifest)
            .reduce((acc, skill) => acc + `- ${skill.name}: ${skill.description}\n`, '');
    }
}
