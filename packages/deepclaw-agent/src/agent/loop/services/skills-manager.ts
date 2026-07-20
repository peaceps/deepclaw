import matter from 'gray-matter';
import { FileUtils } from '@deepclaw/node-utils';
import { SKILL_DIR } from '../../paths';

type SkillManifest = {
    name: string;
    description: string;
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
        const skills: Map<string, SkillDocument> = new Map();
        const files = FileUtils.readDir(SKILL_DIR, (fileName: string) => `${fileName}/SKILL.md`);
        for (const fileContent of Object.values(files)) {
            const skillDocument = this.parseSkillDocument(fileContent.replace(/\r\n/g, '\n'));
            if (skillDocument) {
                skills.set(skillDocument.manifest.name, skillDocument);
            }
        }
        this.skills = skills;
        this.skillPrompt = this.generateSkillPrompt();
    }

    public static reloadSkills(): string {
        this.loadSkills();
        return this.getAvailableSkills();
    }

    private static parseSkillDocument(fileContent: string): SkillDocument | null {
        const {data, content} = matter(fileContent);

        if (!data['name'] || !data['description']) {
            return null;
        }

        return {
            manifest: {
                name: data['name'],
                description: data['description'],
            },
            body: content,
        };
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

Skills available:
${SkillsManager.getAvailableSkills()}`
    }

    private static getAvailableSkills(): string {
        if (this.skills.size === 0) {
            return '(no skills available)';
        }
        return Array.from(this.skills.values()).map(skill => skill.manifest)
            .reduce((acc, skill) => acc + `- ${skill.name}: ${skill.description}\n`, '');
    }
}
