/**
 * The session being talked in. Starting a new conversation moves the whole of this folder under
 * ARCHIVED_DIR, so what reads a session never has to ask which one is current.
 */
export const SESSION_DIR = 'session';
/** Where the conversations that were closed are kept, one folder per session. */
export const ARCHIVED_DIR = 'archived';
// Agent session
export const AGENTS_DIR = '.agents';
export const AGENT_MD = 'AGENT.md';
export const AGENT_SOUL_JSON = 'SOUL.json';

// Project session
export const PROJECT_DIR = '.projects';
export const PROJECT_JSON = 'project.json';

// Folders under each session
export const TOOL_RESULT_DIR = 'tool_results';
export const HISTORY_DIR = 'history';
export const BACKGROUND_COMMANDS_DIR = 'background_commands';
export const HISTORY_COMPACT_FILE = 'history_compact.jsonl';
export const SESSION_HISTORY_FILE = 'messages.jsonl';
export const SESSION_METADATA_FILE = 'session.json';
export const MEMORY_DIR = 'memory';
export const CHAT_FILE = 'chat.jsonl';

// Spawned loop temp, one folder per run and gone with it
export const SUB_LOOP_DIR = 'subloop';
export const TASK_LOOP_DIR = 'taskloop';

// Skills
export const SKILLS = 'skills';
export const SKILLS_DIR = `${AGENTS_DIR}/${SKILLS}`;
export const SKILL_MD = 'SKILL.md';
export const SKILL_AGENT_JSON = 'agent.json';
// Leftovers of the "npx skills" cli: it links installed skills into a bare "skills" folder and
// tracks them in a lock file beside it. Named apart from the folder above, which is ours to move.
export const SKILLS_LINK_DIR = 'skills';
export const SKILLS_LOCK_FILE = 'skills-lock.json';

// Cron
export const CRON_DIR = '.cron';
export const CRON_TASK_JSON = 'cron.json';
export const CRON_HISTORY_JSONL = 'history.jsonl';

// Global
export const GLOBAL_MEMORY_DIR = '.memory';
export const DEEPCLAW_MD = 'DEEPCLAW.md';

// What a run hands to the user, beside the project or the cron task it came out of. The files are
// the ones the work produced, the output is the report of it, filed away when it grew too long.
export const FILES_DIR = 'files';
export const OUTPUT_DIR = 'output';

export function projectFilesDir(projectId: string): string {
    return `${PROJECT_DIR}/${projectId}/${FILES_DIR}`;
}

export function projectOutputDir(projectId: string): string {
    return `${PROJECT_DIR}/${projectId}/${OUTPUT_DIR}`;
}

export function cronFilesDir(cronId: string): string {
    return `${CRON_DIR}/${cronId}/${FILES_DIR}`;
}

export function cronOutputDir(cronId: string): string {
    return `${CRON_DIR}/${cronId}/${OUTPUT_DIR}`;
}
