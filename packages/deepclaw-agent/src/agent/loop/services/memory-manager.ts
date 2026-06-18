import matter from 'gray-matter';
import { FileUtils } from '@deepclaw/node-utils';
import { AGENTS_DIR, MEMORY_DIR, MEMORY_INDEX_FILE } from '../../paths';
import { loadConfig, DeepclawConfig } from '@deepclaw/config';

const MEMORY_INDEX_LINES = 100;
const MEMORY_INDEX_LINE_LENGTH = 200;

const MEMORY_PROMPT = `
When to save memories:
- User states a preference ("I like tabs", "always use pytest") -> type: user
- User corrects you ("don't do X", "that was wrong because...") -> type: feedback
- You learn a project fact that is not easy to infer from current code alone
  (for example: a rule exists because of compliance, or a legacy module must
  stay untouched for business reasons) -> type: project
- You learn where an external resource lives (ticket board, dashboard, docs URL)
  -> type: reference

When NOT to save:
- Anything easily derivable from code (function signatures, file structure, directory layout)
- Temporary task state (current branch, open PR numbers, current TODOs)
- Secrets or credentials (API keys, passwords)`;

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

type Memory = {
    type: MemoryType;
    datetime: string;
    name: string;
    description: string;
    content: string;
};

// TODO 定期整理记忆库，删除过期、重复、不重要的记忆
export class MemoryManager {
    private static allMemories: Map<string, Map<string, Map<string, Memory>>> = this.loadMemories();
    private static memoryPrompt: Record<string, string> = this.generateMemoryPrompt();

    private static loadMemories(): Map<string, Map<string, Map<string, Memory>>> {
        const memoriesMap = new Map<string, Map<string, Map<string, Memory>>>();
        for (const agent of loadConfig<DeepclawConfig['agents']>('agents')) {
            memoriesMap.set(agent.id, this.loadMemoriesForAgent(agent.id));
        }
        return memoriesMap;
    }

    private static loadMemoriesForAgent(agentId: string): Map<string, Map<string, Memory>> {
        const memories: Map<string, Map<string, Memory>> = new Map();
        const files = FileUtils.readDir(`${this.getMemoryDir(agentId)}`, (file: string) => file === MEMORY_INDEX_FILE ? '' : file);
        for (const fileContent of Object.values(files)) {
            try {
                const {data, content} = matter(fileContent.replace(/\r\n/g, '\n'));
                if (data && data['type'] && data['name'] && data['description']) {
                    if (!['user', 'feedback', 'project', 'reference'].includes(data['type'])) {
                        continue;
                    }
                    if (!memories.has(data['type'])) {
                        memories.set(data['type'], new Map());
                    }
                    memories.get(data['type'])!.set(data['name'], {
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

    private static generateMemoryPrompt(): Record<string, string> {
        const memoryPrompt: Record<string, string> = {};
        for (const agentId of this.allMemories.keys()) {
            memoryPrompt[agentId] = this.generateMemoryPromptForAgent(agentId);
        }
        return memoryPrompt;
    }

    private static generateMemoryPromptForAgent(agentId: string): string {
        let prompt = `${MEMORY_PROMPT}\n\n`;
        prompt += '# Memories (persistent across sessions)\n\n';
        if (!this.allMemories.get(agentId)?.size) {
            prompt += '(none on disk yet)\n';
            return prompt;
        }
        const agentMemories = this.allMemories.get(agentId)!;
        for (const type of Array.from(agentMemories.keys())) {
            prompt += `## ${type}\n\n`;
            const memories = Array.from(agentMemories.get(type)!.values());
            memories.sort((a, b) => b.datetime.localeCompare(a.datetime));
            prompt += memories.map(
                m => `### ${m.name}: ${m.description}\n${m.content}`
            ).join('\n');
        }
        return prompt;
    }

    public static getMemoryPrompt(agentId: string): string {
        return this.memoryPrompt[agentId] || '';
    }

    public static addMemory(agentId: string, memory: Omit<Memory, 'datetime'>): void {
        const agentMemories = this.allMemories.get(agentId);
        if (!agentMemories) return;
        const datetime = new Date().toISOString();
        if (!agentMemories.has(memory.type)) {
            agentMemories.set(memory.type, new Map());
        }
        agentMemories.get(memory.type)!.set(memory.name, {
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
        FileUtils.writeFile(`${this.getMemoryDir(agentId)}/${memory.name}.md`, md);
        this.rewriteIndex(agentId);
        this.memoryPrompt[agentId] = this.generateMemoryPromptForAgent(agentId);
    }

    private static rewriteIndex(agentId: string): void {
        const agentMemories = this.allMemories.get(agentId);
        if (!agentMemories) return;
        let index = '';
        for (const type of Array.from(agentMemories.keys())) {
            const memories = Array.from(agentMemories.get(type)!.values());
            memories.sort((a, b) => b.datetime.localeCompare(a.datetime));
            index += memories.slice(0, MEMORY_INDEX_LINES).map(
                m => `Type: ${type} -> Name: ${m.name} -> Description: ${m.description?.slice(0, MEMORY_INDEX_LINE_LENGTH) || ''}`
            ).join('\n');
        }
        FileUtils.writeFile(`${this.getMemoryDir(agentId)}/${MEMORY_INDEX_FILE}`, index);
    }

    private static getMemoryDir(agentId: string): string {
        return `${AGENTS_DIR}/${agentId}/${MEMORY_DIR}`;
    }
}
