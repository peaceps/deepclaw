import path from 'path';
import fs from 'fs';
import matter from 'gray-matter';

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
    private static skills: Map<string, SkillDocument> = this.loadSkills();

    public static getAvailableSkills(): string {
        if (this.skills.size === 0) {
            return '(no skills available)';
        }
        return Array.from(this.skills.values()).map(skill => skill.manifest)
            .reduce((acc, skill) => acc + `- ${skill.name}: ${skill.description}\n`, '');
    }

    public static getSkillContent(skillName: string): string {
        const skillDocument = this.skills.get(skillName);
        if (!skillDocument) {
            return `Error: Unknown skill: ${skillName}. Available skills: ${Array.from(this.skills.keys()).join(', ')}.`;
        }
        return `<skill name="${skillName}">\n${skillDocument.body}\n</skill>`;
    }

    private static loadSkills(): Map<string, SkillDocument> {
        const skills: Map<string, SkillDocument> = new Map();
        for (const fileName of fs.readdirSync(SKILL_DIR)) {
            const fileContent = fs.readFileSync(path.join(SKILL_DIR, fileName, 'SKILL.md'), 'utf8');
            const skillDocument = this.parseSkillDocument(fileContent.replace(/\r\n/g, '\n'));
            if (skillDocument) {
                skills.set(skillDocument.manifest.name, skillDocument);
            }
        }
        return skills;
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
}