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
/**
 * What this agent has learned of the limits it talks through. Per agent rather than per model,
 * because a window is as much the gateway's as the model's: the same model name behind two base
 * urls can be capped differently, and one of them may put a limit on the bytes of a request that
 * the other has no opinion about. An agent's llm config is exactly one such pair.
 */
export const AGENT_LLM_WINDOW_JSON = 'llm-window.json';

// Project session
export const PROJECT_DIR = '.projects';
/**
 * Where a project the user put away is kept, whole, under the id it had. Beside the live folder
 * rather than inside it, so that what reads the projects reads only projects. Being here is what
 * archived means: moving a folder back is the way back, and it comes back with everything it had,
 * the paths its report is filed under included.
 */
export const ARCHIVED_PROJECT_DIR = '.archivedProjects';
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
/** The record of a task as one file, which is what it was before it was sharded. */
export const CRON_HISTORY_JSONL = 'history.jsonl';

/** Where the shards of the record live, each named for the run it opens with. */
export const CRON_HISTORY_DIR = 'history';

// Global
export const GLOBAL_MEMORY_DIR = '.memory';
export const DEEPCLAW_MD = 'DEEPCLAW.md';

// What a run hands to the user, beside the project or the cron task it came out of. The files are
// the ones the work produced, the output is the report of it, filed away when it grew too long.
export const FILES_DIR = 'files';
export const OUTPUT_DIR = 'output';
/** The checkouts of the project's repository, one per task that asked to work in one of its own. */
export const WORKTREES_DIR = 'worktrees';

/**
 * Where a task's own checkout of the project's repository stands, one folder per task.
 *
 * Under our own data rather than beside the repository the project named. That folder is the user's,
 * lent to us for the work, and a checkout dropped next to it is litter in a place we do not own --
 * while here it is inside the workspace already, so a run working in one reads and writes its files
 * without a question asked per file.
 *
 * Named for the task and not for the run of it: a task picked up again is picked up where it was
 * left, which is the branch and the half-done work already lying in this folder.
 */
export function projectWorktreeDir(projectId: string, taskId: string): string {
    return `${PROJECT_DIR}/${projectId}/${WORKTREES_DIR}/${taskId}`;
}

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
