import { FileUtils } from '@deepclaw/node-utils';
import { DeepclawConfig } from '@deepclaw/config';
import { PROJECT_DIR } from '../../paths';
import type { Project, Task, StandaloneTask, TaskStepsContext } from '@deepclaw/core';

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
                    project.priority = project.priority || 'low';
                    if (project.id === 'standalone') {
                        this.projects.standalone.persistent = project.tasks;
                    } else {
                        Object.assign(project, this.calculateProjectTaskInfo(project.tasks));
                        this.projects.projects[project.id] = project;
                    }
                }
            } catch {
                // TODO: Handle error
                continue;
            }
        }
    }

    private static saveProject(projectId: string): void {
        const project = projectId === 'standalone' ? {
            id: 'standalone',
            title: 'Standalone tasks',
            description: 'A virtual project to hold standalone tasks that are not associated with any project.',
            creator: 'main',
            tasks: this.projects.standalone.persistent,
            priority: 'low',
            ongoingTasks: [],
            canStartTasks: [],
            completedTasks: []
        } : this.projects.projects[projectId];
        if (!project) {
            throw new Error(`Project ${projectId} not found!`);
        }
        FileUtils.writeFile(`${PROJECT_DIR}/${project.id}.json`, JSON.stringify(project, null, 2));
    }

    public static createProject({id, title, description, priority, creator, tasks}: {
        id: string;
        title: string;
        description: string;
        priority: Project<Task>['priority'];
        creator: string;
        tasks: Record<string, Task>;
    }): Project<Task> {
        const project: Project<Task> = {
            id,
            title,
            description,
            priority,
            createdAt: new Date().toISOString(),
            creator,
            tasks,
            ...ProjectManager.calculateProjectTaskInfo(tasks)
        };
        this.projects.projects[project.id] = project;
        this.saveProject(project.id);
        return project;
    }

    public static createStandaloneTask(task: StandaloneTask, persistent: boolean): void {
        const standaloneProject = this.projects.standalone;
        if (persistent) {
            standaloneProject.persistent[task.title] = task;
            this.saveProject('standalone');
        } else {
            standaloneProject.transient[task.title] = task;
        }
    }

    public static updateTask(projectId: string, taskInfo: {title: string; assignee?: string; status: Task['status'], steps?: string[]}): Task {
        let task: Task | undefined;
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
        if (taskInfo.status === 'done' && taskInfo.steps) {
            throw new Error('Cannot add steps and mark task done at the same time.');
        }
        if (taskInfo.status === 'done' && !this.isStepsCompleted(task)) {
            throw new Error('All steps should be completed before marking the task as done.');
        }
        if (taskInfo.steps?.length) {
            if (task.status === 'ongoing' && !!task.stepsStatus?.steps || task.status === 'done') {
                throw new Error('Cannot update steps.')
            }
            task.stepsStatus = {
                steps: taskInfo.steps,
                currentStepIndex: -1
            };
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
            Object.assign(project, this.calculateProjectTaskInfo(project.tasks));
            this.saveProject(project.id);
        } else if (this.projects.standalone.persistent[taskInfo.title]) {
            this.saveProject('standalone');
        }
        return task;
    }

    public static updateCurrentStep(projectId: string, taskTitle: string, stepIndex: number): TaskStepsContext {
        const task = this.getTask(projectId, taskTitle);
        const context = task?.stepsStatus;
        if (!context) {
            throw new Error('No steps found for the specified task.');
        }
        if (task.status !== 'ongoing') {
            throw new Error('Can only update current step for ongoing tasks.');
        }
        if (stepIndex < 0 || stepIndex > context.steps.length) {
            throw new Error('Invalid step index.');
        }
        if (context.steps.length === 0) {
            throw new Error('agent.tools.project.taskSteps.empty');
        }
        context.currentStepIndex = stepIndex;
        this.saveProject(projectId);
        return context;
    }

    private static isStepsCompleted(task: Task): boolean {
        const context = task.stepsStatus;
        if (!context || context.steps.length === 0) {
            return true;
        }
        return context.currentStepIndex === context.steps.length;
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
        return project;
    }

    private static calculateProjectTaskInfo(tasks: Record<string, Task>): {
        completedTasks: string[];
        ongoingTasks: string[];
        canStartTasks: string[];
    } {
        return {
            completedTasks: Object.values(tasks).filter(task => task.status === 'done').map(task => task.title),
            ongoingTasks: Object.values(tasks).filter(task => task.status === 'ongoing').map(task => task.title),
            canStartTasks: Object.values(tasks).filter(task => task.status === 'todo' &&
                task.blockedBy.every(blockedBy => tasks[blockedBy]?.status === 'done')).map(task => task.title),
        };
    }

    public static getStandaloneTaskDetail(taskTitle: string): StandaloneTask {
        const task = this.projects.standalone.persistent[taskTitle] || this.projects.standalone.transient[taskTitle];
        if (!task) {
            throw new Error('Standalone task not found.');
        }
        return task;
    }

    public static wrapStandaloneTask(task: StandaloneTask): Project<StandaloneTask> {
        const project: Project<StandaloneTask> = {
            id: `standalone-${task.title}`,
            title: task.title,
            description: '',
            tasks: {[task.title]: task},
            creator: task.creator,
            priority: task.priority || 'low',
            createdAt: task.createdAt,
            closedAt: task.closedAt,
            canStartTasks: [],
            ongoingTasks: [],
            completedTasks: [],
        };
        if (task.status === 'todo') {
            project.canStartTasks.push(task.title);
        } else if (task.status === 'ongoing') {
            project.ongoingTasks.push(task.title);
        } else {
            project.completedTasks.push(task.title);
        }
        return project;
    }

    private static getTask(projectId: string, taskTitle: string): Task | undefined {
        if (projectId === 'standalone') {
            return this.projects.standalone.persistent[taskTitle] || this.projects.standalone.transient[taskTitle];
        }
        return this.projects.projects[projectId]?.tasks[taskTitle];
    }

    public static prompts(agentMode: DeepclawConfig['agents'][0]['mode']): string {
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
steps info are important for user to get current task execution status, so make sure to update them in a timely manner.

## Update task status
${agentMode !== 'agent' ? 'You are in plan mode so you can only plan and chat. You don\'t have update tools and cannot update the task status.' :
    `You can update a task with update_task tool and update the step index with update_task_current_step tool.
For standalone tasks just set project id "standalone".
It's also allowed for subloop agents to take action on tasks, and update task status.`}`;
    }
}
