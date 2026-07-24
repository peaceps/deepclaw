import matter from 'gray-matter';
import { FileUtils } from '@deepclaw/node-utils';
import { SKILL_AGENT_JSON, SKILL_MD, SKILLS_DIR } from '../../paths';

export type SkillManifest = {
    name: string;
    description: string;
    dir: string;
}

type SkillDocument = {
    manifest: SkillManifest;
    body: string;
    agents?: string[];
}

export type SkillInfo = {
    name: string;
    description: string;
    agents?: string[];
}

export class SkillsManager {
    private static skills: Map<string, SkillDocument>;

    public static getSkillContent(skillName: string): string {
        if (!this.skills) {
            this.reloadSkills();
        }
        const skillDocument = this.skills.get(skillName);
        if (!skillDocument) {
            return `Error: Unknown skill: ${skillName}. Available skills: ${Array.from(this.skills.keys()).join(', ')}.`;
        }
        return `<skill name="${skillName}">\n${skillDocument.body}\n</skill>`;
    }

    public static reloadSkills(): void {
        this.skills = new Map();
        const files = FileUtils.readDir(SKILLS_DIR, (fileName: string) => `${fileName}/${SKILL_MD}`);
        for (const {dir, content} of Object.values(files)) {
            this.parseSkillDocument(content, dir);
        }
    }

    public static deleteSkill(name: string): void {
        if (!this.skills.has(name)) {
            return;
        }
        FileUtils.deleteDir(`${SKILLS_DIR}/${this.skills.get(name)!.manifest.dir}`);
        this.skills.delete(name);
    }

    public static installSkill(folder: string, files: {path: string, content: string}[]): void {
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

    public static generateSkillPrompt(agentId: string): string {
        return `You have below skills installed:
${this.getAvailableSkillsPrompt(agentId)}

When user ask for some skill, first check from above available skills.
If not found, use find-skills skill to search from public skills.

load_skill tool is a local function to get the detailed information of skills.
You always need to use load_skill tool with function_call first.

NEVER use file tool or shell tool to search files on disk for skills!!!
`;
    }

    public static getAvailableSkillsPrompt(agentId: string): string {
        if (!this.skills) {
            this.reloadSkills();
        }
        const skills = Array.from(this.skills.values()).filter(skill =>
            !skill.agents || skill.agents.includes(agentId)
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
