import matter from 'gray-matter';
import { FileUtils } from '@deepclaw/node-utils';
import { AGENTS_DIR, GLOBAL_MEMORY_DIR, MEMORY_DIR, PROJECT_DIR } from '../../paths';

const MEMORY_INDEX_LINES = 100;
const MEMORY_INDEX_LINE_LENGTH = 200;

const MEMORY_PROMPT = `
When to save memories:
- type preference: user's or team's preferred style, habits, defaults, tool choices.
- type rules: constraints, corrections, project facts, decisions, safety/business rules that should be followed later.
- type reference: pointers to external resources, docs, dashboards, tickets, not the copied content.

scope:
- global: applies to all agents/projects.
- agent: private to the current agent.
- project: applies to the current project.

Typical examples:
- global + preference: user's default language or coding style.
- agent + rules: corrections about this agent's behavior.
- project + rules: project-specific constraints or decisions.
- project/global + reference: docs, dashboards, tickets.

When NOT to save:
- Anything easily derivable from code (function signatures, file structure, directory layout)
- Temporary task state (current branch, open PR numbers, current TODOs)
- Secrets or credentials (API keys, passwords)`;

export const MEMORY_TYPES = ['preference', 'rules', 'reference'] as const;
export type MemoryType = typeof MEMORY_TYPES[number];

export const MEMORY_SCOPES = ['global', 'agent', 'project'] as const;
export type MemoryScope = typeof MEMORY_SCOPES[number];

type Memory = {
    type: MemoryType;
    datetime: string;
    name: string;
    description: string;
    content: string;
};

// TODO 定期整理记忆库，删除过期、重复、不重要的记忆
export class MemoryManager {
    private static globalMemories: Map<string, Memory> = this.loadMemoriesFromFolder(GLOBAL_MEMORY_DIR);
    private static globalMemoryIndex: string = this.summary(this.globalMemories, 'global');
    private static agentsMemories: Map<string, Map<string, Memory>> = new Map();
    private static agentsMemoryIndex: Map<string, string> = new Map();
    private static projectsMemories: Map<string, Map<string, Memory>> = new Map();
    private static projectsMemoryIndex: Map<string, string> = new Map();

    private static loadMemoriesFromFolder(folder: string): Map<string, Memory> {
        const memories: Map<string, Memory> = new Map();
        const files = FileUtils.readDir(folder);
        for (const file of Object.values(files)) {
            try {
                const {data, content} = matter(file.content.replace(/\r\n/g, '\n'));
                if (data && data['type'] && data['name'] && data['description']) {
                    if (!MEMORY_TYPES.includes(data['type'] as MemoryType)) {
                        continue;
                    }
                    memories.set(data['name'], {
                        type: data['type'],
                        datetime: data['datetime'] || '',
                        name: data['name'], 
                        description: data['description'],
                        content,
                    });
                }
            } catch {
                // TODO: Handle error
                continue;
            }
        }
        return memories;
    }

    public static getMemoryPrompt(agentId: string, projectId?: string): string {
        this.ensureMemoryLoaded(agentId, projectId);
        const sections: string[] = [];
        if (this.globalMemoryIndex) {
            sections.push(`## Global memories index (shared by all agents)\n${this.globalMemoryIndex}`);
        }
        const agent = this.agentsMemoryIndex.get(agentId);
        if (agent) {
            sections.push(`## Agent memories index (private to this agent)\n${agent}`);
        }
        if (projectId) {
            const project = this.projectsMemoryIndex.get(projectId);
            if (project) {
                sections.push(`## Project memories index (Focus on this project)\n${project}`);
            }
        }
        const body = sections.length ? sections.join('\n\n') : '(none on disk yet)';
        return `${MEMORY_PROMPT}

# Memory indexes (persistent across sessions)
You can get full content via read_memory_detail tool with scope and name.

${body}`;
    }

    public static getMemoryDetail(name: string, agentId?: string, projectId?: string): string {
        if (agentId) {
            this.ensureMemoryLoaded(agentId, projectId);
        }
        const memoryMap = this.getMemoryMap(agentId, projectId);
        if (!memoryMap) return `Memory not found.`;
        const memory = memoryMap.get(name);
        return memory ? memory.content : `Memory not found.`;
    }

    public static addMemory(memory: Omit<Memory, 'datetime'>, agentId?: string, projectId?: string): void {
        if (agentId) {
            this.ensureMemoryLoaded(agentId, projectId);
        }
        const memoryMap = this.getMemoryMap(agentId, projectId);
        if (!memoryMap) return;
        const datetime = new Date().toISOString();
        memoryMap.set(memory.name, {
            type: memory.type,
            datetime,
            name: memory.name,
            description: memory.description,
            content: memory.content,
        });
        const md = matter.stringify(memory.content, {
            type: memory.type,
            name: memory.name,
            description: memory.description,
            datetime,
        });
        const memoryDir = this.getMemoryDir(agentId, projectId);
        FileUtils.writeFile(`${memoryDir}/${memory.name}.md`, md);
        const index = this.summary(memoryMap, this.getMemoryScope(agentId, projectId));
        if (projectId) {
            this.projectsMemoryIndex.set(projectId, index);
        } else if (agentId) {
            this.agentsMemoryIndex.set(agentId, index);
        } else {
            this.globalMemoryIndex = index;
        }
    }

    private static summary(memoryMap: Map<string, Memory>, scope: MemoryScope): string {
        if (!memoryMap?.size) return '';
        let index = '';
        const memories = Array.from(memoryMap.values() || []);
        memories.sort((a, b) => b.datetime.localeCompare(a.datetime));
        index += memories.slice(0, MEMORY_INDEX_LINES).map(
            m => `Scope: ${scope} -> Type: ${m.type} -> Name: ${m.name} -> Description: ${m.description?.slice(0, MEMORY_INDEX_LINE_LENGTH) || ''}`
        ).join('\n') + '\n';
        return index;
    }

    private static ensureMemoryLoaded(agentId: string, projectId?: string) {
        if (!this.agentsMemories.has(agentId)) {
            const memoryMap = this.loadMemoriesFromFolder(this.getMemoryDir(agentId));
            this.agentsMemories.set(agentId, memoryMap);
            this.agentsMemoryIndex.set(agentId, this.summary(memoryMap, 'agent'));
        }
        if (projectId) {
            if (!this.projectsMemories.has(projectId)) {
                const memoryMap = this.loadMemoriesFromFolder(this.getMemoryDir(agentId, projectId));
                this.projectsMemories.set(projectId, memoryMap);
                this.projectsMemoryIndex.set(projectId, this.summary(memoryMap, 'project'));
            }
        }
    }

    private static getMemoryMap(agentId?: string, projectId?: string): Map<string, Memory> | undefined {
        return !agentId ? this.globalMemories : !projectId ? this.agentsMemories.get(agentId) : this.projectsMemories.get(projectId);
    }

    private static getMemoryDir(agentId?: string, projectId?: string): string {
        return !agentId ? GLOBAL_MEMORY_DIR :
            !projectId ? `${AGENTS_DIR}/${agentId}/${MEMORY_DIR}` : `${PROJECT_DIR}/${projectId}/${MEMORY_DIR}`;
    }

    private static getMemoryScope(agentId?: string, projectId?: string): MemoryScope {
        return !agentId ? 'global' : !projectId ? 'agent' : 'project';
    }
}
