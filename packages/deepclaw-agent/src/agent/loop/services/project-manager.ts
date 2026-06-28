import { FileUtils } from '@deepclaw/node-utils';
import { PROJECT_DIR } from '../../paths';
import { type Project, type Task, type TaskStepsContext, getProjectStatus, PROJECT_CONFIG } from '@deepclaw/core';

export type ProjectListInfo = {
    projects: {
        open: {id: string; title: string; description: string}[]; 
        closed: {id: string; title: string; description: string}[]
    };
}

type ProjectInitInfo = {
    agentId: string;
    title: string;
    description: string;
    priority: Project['priority'];
}

type TaskInitInfo = {
    agentId: string;
    title: string;
    description: string;
    priority: Task['priority'];
    steps?: string[];
    blockedBy?: string[];
};

export class ProjectManager {

    private static projects: {[id: string]: Project} = {};

    static {
        this.loadProjects();
    }

    private static loadProjects(): void {
        const files = FileUtils.readDir(PROJECT_DIR);
        for (const fileContent of Object.values(files)) {
            try {
                const project = JSON.parse(fileContent) as Project;
                if (project && project.id && project.title && project.description) {
                    project.priority = project.priority || 'low';
                    Object.assign(project, this.calculateProjectTaskInfo(project.tasks));
                    this.projects[project.id] = project;
                }
            } catch {
                // TODO: Handle error
                continue;
            }
        }
    }

    private static saveProject(projectId: string): void {
        const project = this.projects[projectId];
        if (!project) {
            throw new Error(`Project ${projectId} not found!`);
        }
        FileUtils.writeFile(`${PROJECT_DIR}/${project.id}.json`, JSON.stringify(project, null, 2));
    }

    public static createProject(projectInfo: ProjectInitInfo, tasks: Task[]): Project {
        const taskObject = this.convertTasks(tasks);
        const project: Project = {
            id: crypto.randomUUID(),
            title: projectInfo.title,
            description: projectInfo.description,
            priority: projectInfo.priority,
            creator: projectInfo.agentId,
            createdAt: new Date().toISOString(),
            tasks: taskObject,
            ...this.calculateProjectTaskInfo(taskObject)
        }
        this.projects[project.id] = project;
        this.saveProject(project.id);
        return project;
    }

    public static updateProject(projectInfo: Partial<Omit<Project, "tasks">> & {id: string}, tasks?: Task[]): Project {
        const project = this.projects[projectInfo.id];
        if (!project) {
            throw new Error(`Project ${projectInfo.id} not found.`);
        }
        if (getProjectStatus(project) !== 'todo' && !!tasks) {
            throw new Error('Only projects in todo state can update tasks.')
        }
        if (tasks) {
            project.tasks = this.convertTasks(tasks);
        }
        Object.assign(project, projectInfo);
        if (projectInfo.tags) {
            project.tags = Array.from(new Set(
                projectInfo.tags.map(tag => tag.trim().slice(0, PROJECT_CONFIG.maxTagTextLength)).filter(Boolean)
            )).slice(0, PROJECT_CONFIG.maxTagCount);
        }
        Object.assign(project, this.calculateProjectTaskInfo(project.tasks));
        this.saveProject(project.id);
        return project;
    }

    private static convertTasks(tasks: Task[]): Record<string, Task> {
        if (new Set(tasks.map(task => task.title)).size < tasks.length) {
            throw new Error('There are duplicated task titles.');
        }
        if (tasks.length > PROJECT_CONFIG.maxTasksCount) {
            throw new Error('There are too many tasks.');
        }

        const taskObject = tasks.reduce((p, n) => {
            p[n.title] = n;
            return p;
        }, {} as Record<string, Task>);
        for (const task of Object.values(taskObject)) {
            for (const blockedBy of task.blockedBy) {
                if (!taskObject[blockedBy]) {
                    throw new Error('Invalid blocked task.');
                }
                taskObject[blockedBy].blocks.push(task.title);
            }
        }
        return taskObject;
    }

    public static createTask(taskInfo: TaskInitInfo): Task {
        if (taskInfo.steps?.length && taskInfo.steps?.length > PROJECT_CONFIG.maxTaskStepsCount) {
            throw new Error(`Too much steps for a task. Max is ${PROJECT_CONFIG.maxTaskStepsCount}.`);
        }
        const task: Task = {
            title: taskInfo.title,
            description: taskInfo.description,
            priority: taskInfo.priority,
            status: 'todo',
            assignee: taskInfo.agentId,
            blockedBy: taskInfo.blockedBy || [],
            blocks: [],
            stepsStatus: !taskInfo.steps?.length ? undefined : {
                steps: taskInfo.steps,
                currentStepIndex: -1
            }
        };
        return task;
    }

    public static updateTask(projectId: string, taskInfo: Partial<Task> & {title: string}, steps?: string[]): Task {
        let task: Task | undefined;
        if (steps?.length && steps?.length > PROJECT_CONFIG.maxTaskStepsCount) {
            throw new Error(`Too much steps for a task. Max is ${PROJECT_CONFIG.maxTaskStepsCount}.`);
        }
        task = this.projects[projectId]?.tasks?.[taskInfo.title];
        if (!task) {
            throw new Error('Task not found.');
        }
        if (task.status === 'todo' && taskInfo.status === 'done' ||
            task.status === 'ongoing' && taskInfo.status === 'todo' ||
            task.status === 'done' && taskInfo.status !== 'done') {
            throw new Error('You can only update the status from todo to ongoing or from ongoing to done.');
        }
        if (taskInfo.status === 'done' && steps) {
            throw new Error('Cannot add steps and mark task done at the same time.');
        }
        if (taskInfo.status === 'done' && !this.isStepsCompleted(task)) {
            throw new Error('All steps should be completed before marking the task as done.');
        }
        if (steps?.length) {
            if (task.status === 'ongoing' && !!task.stepsStatus?.steps || task.status === 'done') {
                throw new Error('Cannot update steps.')
            }
            task.stepsStatus = {
                steps,
                currentStepIndex: -1
            };
        }
        Object.assign(task, taskInfo);
        if (!task.closedAt && taskInfo.status === 'done') {
            task.closedAt = new Date().toISOString();
        }
        const project = this.projects[projectId]!;
        if (!project.closedAt && Object.values(project.tasks).every(task => task.status === 'done')) {
            project.closedAt = new Date().toISOString();
        }
        Object.assign(project, this.calculateProjectTaskInfo(project.tasks));
        this.saveProject(project.id);
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
        } as ProjectListInfo;
        for (const project of Object.values(this.projects)) {
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
        return res;
    }

    public static getProjectDetail(projectId: string): Project {
        const project = this.projects[projectId];
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

    private static getTask(projectId: string, taskTitle: string): Task | undefined {
        return this.projects[projectId]?.tasks[taskTitle];
    }

    public static prompts(): string {
        return `
## Project Management tools
You can use project related tools to plan, manage projects.
Projects are considered long term goals that can be broken down into tasks, they will be persisted in file system.
Simple tasks are independent tasks and not related to any project when created,
but they'll be wrapped into a project after it's created and can be searched with get_project_list as the same as normal projects.
They will also be persisted in file system.

## Get project task info
You can get all projects info with get_project_list tool, and get detailed info of a project with get_project_detail tool.

## Create project and simple task
If you are not a subloop agent, you can create projects and simple tasks.
If you consider a job should be a project, use create_project tool to create it.
If one job is not big enough to be a project, you can directly create a simple task with create_simple_task without putting it into a project.
Always create a project/simple task if asked to do something, even if the user didn\'t explicitly ask you to create one.
You can create detailed steps for each task if needed,
steps info are important for user to get current task execution status, so make sure to update them in a timely manner.

## Update task status
You can update a task with update_task tool and update the step index with update_task_current_step tool.
For simple tasks just set the wrapped project id.
It's also allowed for subloop agents to take action on tasks, and update task status.`;
    }
}
