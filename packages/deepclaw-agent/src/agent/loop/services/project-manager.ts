import { DeepclawConfig, FileUtils, loadConfig } from '@deepclaw/utils';

export type Project = {
    id: string;
    title: string;
    description: string;
    createdAt: string;
    closedAt?: string;
    creator: string;
    tasks: Record<string, Task>;
};

export type Task = {
    title: string;
    description: string;
    status: 'todo' | 'ongoing' | 'done';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    blockedBy: string[];
    blocks: string[];
    assignee?: string;
    closedAt?: string;
    creator: string;
};

const PROJECT_DIR = './.projects';

export class ProjectManager {
    private static projects: Project[] = this.loadProjects();

    private static loadProjects(): Project[] {
        const projects: Project[] = [];
        const files = FileUtils.readDir(PROJECT_DIR);
        for (const fileContent of Object.values(files)) {
            try {
                const project = JSON.parse(fileContent);
                if (project && project.id && project.title && project.description) {
                    projects.push(project);
                }
            } catch {
                // TODO: Handle error
                continue;
            }
        }
        return projects;
    }

    private static saveProjects(project: Project): void {
        FileUtils.writeFile(`${PROJECT_DIR}/${project.id}.json`, JSON.stringify(project));
    }

    public static createProject(project: Project): Project {
        this.projects.push(project);
        this.saveProjects(project);
        return project;
    }

    public static updateTask(projectId: string, taskInfo: {title: string; assignee?: string; status: Task['status']}): void {
        const project = this.projects.find(p => p.id === projectId);
        if (!project) {
            throw new Error('Project not found.');
        }
        const task = project.tasks[taskInfo.title];
        if (!task) {
            throw new Error('Task not found.');
        }
        if (task.status === 'todo' && taskInfo.status === 'done' ||
            task.status === 'ongoing' && taskInfo.status === 'todo' ||
            task.status === 'done' && taskInfo.status !== 'done') {
            throw new Error('You can only update the status from todo to ongoing or from ongoing to done.');
        }
        task.status = taskInfo.status;
        task.assignee = taskInfo.assignee || task.assignee;
        if (!task.closedAt && taskInfo.status === 'done') {
            task.closedAt = new Date().toISOString();
        }
        if (!project.closedAt && Object.values(project.tasks).every(task => task.status === 'done')) {
            project.closedAt = new Date().toISOString();
        }
        this.saveProjects(project);
    }

    public static getProjectInfo(projectId: string): string {
        const project = this.projects.find(p => p.id === projectId);
        if (!project) {
            return '<Project not found.>';
        }
        return JSON.stringify({
            id: project.id,
            title: project.title,
            description: project.description,
            createdAt: project.createdAt,
            closedAt: project.closedAt,
            tasks: Object.values(project.tasks).map(task => ({
                title: task.title,
                description: task.description,
                status: task.status,
                priority: task.priority,
                blockedBy: task.blockedBy,
                blocks: task.blocks,
                assignee: task.assignee,
                closedAt: task.closedAt,
            })),
            ongoingTasks: Object.values(project.tasks).filter(task => task.status === 'ongoing'),
            canStartTasks: Object.values(project.tasks).filter(task => task.status === 'todo' &&
                task.blockedBy.every(blockedBy => project.tasks[blockedBy]?.status === 'done')),
        });
    }

    public static prompts(): string {
        const agentMode = loadConfig<DeepclawConfig['agent']['mode']>('agent.mode', 'chat')!;
        const ongoingProjects = this.projects.filter(p => !p.closedAt);
        const finishedProjects = this.projects.filter(p => !!p.closedAt);
        return `
You can use project tool to manage projects, which are considered long term goals that can be broken down into tasks,
they will be persisted in file system.
If you consider a job should be a project, use create_project tool to create it.
${agentMode !== 'agent' ? 'You are in plan mode so you can only plan and chat. You don\'t have update_task tool.' : ''}

Here are the projects ongoing:
${ongoingProjects.map(p => `${p.id}: ${p.title}`).join('\n') || '<No projects ongoing.>'}
Here are the projects finished:
${finishedProjects.map(p => `${p.id}: ${p.title}`).join('\n') || '<No projects finished.>'}
You can get detailed project infos with their tasks status with get_project_info tool.`;
    }
}
