import { Project, Task } from "@deepclaw/loop-gateway";

export function getProjectProgress(project?: Project<Task> | null): number | null {
    let progress = null;
    if (project) {
        const total = Object.values(project.tasks).length;
        const done = Object.values(project.tasks).filter(task => task.status === 'done').length;
        progress = total > 0 ? (done / total * 100) : 0;
    }
    return progress;
}