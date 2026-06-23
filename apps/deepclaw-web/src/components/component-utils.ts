import type { Project, Task, MissionStatus } from "@deepclaw/core";
import { LANG_LOCALE_MAP } from "@deepclaw/i18n";

export function getProjectStatus(project: Project): MissionStatus {
    if (!project.closedAt) {
        return !project.ongoingTasks.length ? 'todo' : 'ongoing';
    }
    return 'done';
}

export function getProjectProgress(project?: Project | null): string | null {
    let progress = null;
    if (project) {
        const total = Object.values(project.tasks).length;
        const done = Object.values(project.tasks).filter(task => task.status === 'done').length;
        progress = total > 0 ? (done / total * 100).toFixed(2) : '0';
    }
    return progress;
}

export function getTaskProgress(task: Task): string | null {
    if (task.status !== 'ongoing' || !task.stepsStatus?.steps.length) {
        return null;
    }
    if (task.stepsStatus.currentStepIndex < 0) {
        return '0';
    }
    return (((task.stepsStatus.currentStepIndex) / task.stepsStatus.steps.length) * 100).toFixed(2);
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
