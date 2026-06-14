import type { Project, Task, ProjectStatus } from "@deepclaw/loop-gateway";
import { LANG_LOCALE_MAP } from "@deepclaw/i18n";

export function getProjectStatus(project: Project<Task>): ProjectStatus {
    if (!project.closedAt) {
        return !project.ongoingTasks.length ? 'todo' : 'ongoing';
    }
    return 'done';
}

export function getProjectProgress(project?: Project<Task> | null): number | null {
    let progress = null;
    if (project) {
        const total = Object.values(project.tasks).length;
        const done = Object.values(project.tasks).filter(task => task.status === 'done').length;
        progress = total > 0 ? (done / total * 100) : 0;
    }
    return progress;
}

export function formatDate(lang: string, dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString(getLocale(lang), {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
}

function getLocale(lang: string): string {
    return LANG_LOCALE_MAP[lang];
}
