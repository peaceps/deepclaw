import path from "path";
import fs from "fs";

type SkillManifest = {
    name: string;
    description: string;
}

type SkillDocument = {
    manifest: SkillManifest;
    body: string;
}

const SKILL_DIR = path.resolve('agent/skills');

export class SkillsManager {
    private skills: Map<string, SkillDocument> = new Map();

    constructor() {
        this.loadSkills();
    }

    public getAvailableSkills(): string {
        if (this.skills.size === 0) {
            return '(no skills available)';
        }
        return Array.from(this.skills.values()).map(skill => skill.manifest)
            .reduce((acc, skill) => acc + `- ${skill.name}: ${skill.description}\n`, '');
    }

    public getSkillContent(skillName: string): string {
        const skillDocument = this.skills.get(skillName);
        if (!skillDocument) {
            return `Error: Unknown skill: ${skillName}. Available skills: ${Array.from(this.skills.keys()).join(', ')}.`;
        }
        return `<skill name="${skillName}">\n${skillDocument.body}\n</skill>`;
    }

    private loadSkills(): void {
        for (const fileName of fs.readdirSync(SKILL_DIR)) {
            const fileContent = fs.readFileSync(path.join(SKILL_DIR, fileName, 'SKILL.md'), 'utf8');
            const skillDocument = this.parseSkillDocument(fileContent.replace(/\r\n/g, '\n'));
            if (skillDocument) {
                this.skills.set(skillDocument.manifest.name, skillDocument);
            }
        }
    }

    private parseSkillDocument(fileContent: string): SkillDocument | null {
        const match = fileContent.match(/^---\n(.*?)\n---\n(.*)/s);
        if (!match) {
            return null;
        }
        const [_, meta = '', body = ''] = match;

        const manifest: SkillManifest = {
            name: '',
            description: '',
        };
        for (const line of meta.split('\n')) {
            if (line.includes(':')) {
                const [key = '', value = ''] = line.split(':');
                if (key.trim() === 'name') {
                    manifest.name = value.trim();
                } else if (key.trim() === 'description') {
                    manifest.description = value.trim();
                }
            }
        }

        return {
            manifest,
            body,
        };
    }
}