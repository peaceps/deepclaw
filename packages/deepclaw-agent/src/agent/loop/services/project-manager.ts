import { FileUtils } from '@deepclaw/utils';
import { DeepclawConfig, loadConfig } from '@deepclaw/config';
import { TaskStepsManager } from './task-steps-manager';

export type Project<T extends Task> = {
    id: string;
    title: string;
    description: string;
    createdAt?: string;
    closedAt?: string;
    creator: string;
    tasks: Record<string, T>;
    completedTasks?: string[];
    ongoingTasks?: string[];
    canStartTasks?: string[];
};

export type ProjectListInfo = {
    projects: {
        open: {id: string; title: string; description: string}[]; 
        closed: {id: string; title: string; description: string}[]
    };
    standaloneTasks: {
        open: {title: string; description: string}[];
        closed: {title: string; description: string}[]
    }
}

export type Task = {
    title: string;
    description: string;
    status: 'todo' | 'ongoing' | 'done';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    blockedBy: string[];
    blocks: string[];
    assignee?: string;
    closedAt?: string;
    creator: string; // standalone
    progress?: number;
    tags?: string[];
};

export type StandaloneTask = Task & {
    createdAt: string; // for standalone tasks
}

const PROJECT_DIR = './.projects';

export class ProjectManager {

    private static projects: {
        projects: {[key: string]: Project<Task>};
        standalone: {
            persistent: Record<string, StandaloneTask>;
            transient: Record<string, StandaloneTask>;
        };
    } = {
        standalone: {
            persistent: {},
            transient: {},
        },
        projects: {},
    };

    static {
        this.loadProjects();
    }

    private static loadProjects(): void {
        const files = FileUtils.readDir(PROJECT_DIR);
        for (const fileContent of Object.values(files)) {
            try {
                const project = JSON.parse(fileContent);
                if (project && project.id && project.title && project.description) {
                    if (project.id === 'standalone') {
                        this.projects.standalone.persistent = project.tasks;
                    } else {
                        this.projects.projects[project.id] = project;
                    }
                }
            } catch {
                // TODO: Handle error
                continue;
            }
        }
    }

    private static saveProjects(project: Project<Task>): void {
        FileUtils.writeFile(`${PROJECT_DIR}/${project.id}.json`, JSON.stringify(project));
    }

    private static saveStandaloneProject(): void {
        const standaloneProject: Project<StandaloneTask> = {
            id: 'standalone',
            title: 'Standalone tasks',
            description: 'A virtual project to hold standalone tasks that are not associated with any project.',
            creator: 'main',
            tasks: this.projects.standalone.persistent,
        };
        this.saveProjects(standaloneProject);
    }

    public static createProject(project: Project<Task>): Project<Task> {
        this.projects.projects[project.id] = project;
        this.saveProjects(project);
        return project;
    }

    public static createStandaloneTask(task: StandaloneTask, persistent: boolean): void {
        const standaloneProject = this.projects.standalone;
        if (persistent) {
            standaloneProject.persistent[task.title] = task;
            this.saveStandaloneProject();
        } else {
            standaloneProject.transient[task.title] = task;
        }
    }

    public static updateTask(projectId: string, taskInfo: {title: string; assignee?: string; status: Task['status']}): void {
        let task;
        if (projectId === 'standalone') {
            task = this.projects.standalone.persistent[taskInfo.title] || this.projects.standalone.transient[taskInfo.title];
        } else {
             task = this.projects.projects[projectId]?.tasks?.[taskInfo.title];
        }
        if (!task) {
            throw new Error('Task not found.');
        }
        if (task.status === 'todo' && taskInfo.status === 'done' ||
            task.status === 'ongoing' && taskInfo.status === 'todo' ||
            task.status === 'done' && taskInfo.status !== 'done') {
            throw new Error('You can only update the status from todo to ongoing or from ongoing to done.');
        }
        if (taskInfo.status === 'done' && !TaskStepsManager.isStepsCompleted(projectId, taskInfo.title)) {
            throw new Error('All steps should be completed before marking the task as done.');
        }
        task.status = taskInfo.status;
        task.assignee = taskInfo.assignee || task.assignee;
        if (!task.closedAt && taskInfo.status === 'done') {
            task.closedAt = new Date().toISOString();
        }
        if (projectId !== 'standalone') {
            const project = this.projects.projects[projectId]!;
            if (!project.closedAt && Object.values(project.tasks).every(task => task.status === 'done')) {
                project.closedAt = new Date().toISOString();
            }
            this.saveProjects(project);
        } else if (this.projects.standalone.persistent[taskInfo.title]) {
            this.saveStandaloneProject();
        }
    }

    public static getProjectList(includingClosed: boolean): ProjectListInfo {
        const res = {
            projects: {
                open: [],
                closed: [],
            },
            standaloneTasks: {
                open: [],
                closed: [],
            },
        } as ProjectListInfo;
        for (const project of Object.values(this.projects.projects)) {
            const toPush = {
                id: project.id,
                title: project.title,
                description: project.description,
            };
            if (project.closedAt) {
                if (includingClosed) {
                    res.projects.closed.push(toPush);
                }
            } else {
                res.projects.open.push(toPush);
            }
        }
        for (const task of Object.values(this.projects.standalone.persistent)
                .concat(Object.values(this.projects.standalone.transient))) {
            const toPush = {
                title: task.title,
                description: task.description,
            };
            if (task.status === 'done') {
                if (includingClosed) {
                    res.standaloneTasks.closed.push(toPush);
                }
            } else {
                res.standaloneTasks.open.push(toPush);
            }
        }
        return res;
    }

    public static getProjectDetail(projectId: string): Project<Task> {
        const project = this.projects.projects[projectId];
        if (!project) {
            throw new Error('Project not found.');
        }
        return {
            ...project,
            completedTasks: Object.values(project.tasks).filter(task => task.status === 'done').map(task => task.title),
            ongoingTasks: Object.values(project.tasks).filter(task => task.status === 'ongoing').map(task => task.title),
            canStartTasks: Object.values(project.tasks).filter(task => task.status === 'todo' &&
                task.blockedBy.every(blockedBy => project.tasks[blockedBy]?.status === 'done')).map(task => task.title),
        };
    }

    public static getStandaloneTaskDetail(taskTitle: string): StandaloneTask {
        const task = this.projects.standalone.persistent[taskTitle] || this.projects.standalone.transient[taskTitle];
        if (!task) {
            throw new Error('Standalone task not found.');
        }
        return task;
    }

    public static prompts(): string {
        const agentMode = loadConfig<DeepclawConfig['agent']['mode']>('agent.mode', 'chat')!;
        return `
## Project Management tools
You can use project related tools to plan, manage projects as well as standalone tasks.
Projects are considered long term goals that can be broken down into tasks, they will be persisted in file system.
Standalone tasks are independent tasks that are not associated with any project,
they can be persisted in file system or be transient only in memory, but you don't need to care if it's persistent or transient.

## Get project and standalone task info
You can get all projects info with get_project_list tool, and get detailed info of a project with get_project_detail tool
and for standalone task with get_standalone_task_detail tool.

## Create project and standalone task
If you are not a subloop agent, you can create project and standalone tasks.
If you consider a job should be a project, use create_project tool to create it.
If one job is not big enough to be a project, you can directly create a standalone task with create_standalone_task without putting it into a project.
Always create a project/standalone task if asked to do something, even if the user didn\'t explicitly ask you to create one.
You can create detailed steps for each task if needed,
steps info are transient and will not be persisted after app restart, so make sure to update them in a timely manner.

## Update task status
${agentMode !== 'agent' ? 'You are in plan mode so you can only plan and chat. You don\'t have update tools and cannot update the task status.' :
    `You can update a task with update_task tool and update the step index with update_task_current_step tool.
For standalone tasks just set project id "standalone".
It's also allowed for subloop agents to take action on tasks, and update task status.`}`;
    }
}
