import { FileUtils, UpdateContent } from '@deepclaw/node-utils';
import { ARCHIVED_PROJECT_DIR, PROJECT_DIR, PROJECT_JSON, projectOutputDir } from '../../paths';
import { type Project, type Task, type TaskStepsContext, getProjectStatus, MissionPriority, PROJECT_CONFIG } from '@deepclaw/core';
import { fileAwayOutput } from '../../loop-utils';
import { OneLoopContext } from '../../definitions/definitions';

/** What the report of a project is filed under, beside the reports of its tasks. */
const PROJECT_REPORT = 'report';

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
    priority: MissionPriority;
}

type TaskInitInfo = {
    agentId: string;
    id: string;
    title: string;
    description: string;
    priority: MissionPriority;
    steps?: string[];
    blockedBy?: string[];
    /** Whoever has to work on the task, the agent that plans it when nobody else was named. */
    assignee?: string;
};

export class ProjectManager {

    private static projects: {[id: string]: Project} = {};

    static {
        this.loadProjects();
    }

    private static loadProjects(): void {
        const files = FileUtils.readDir(PROJECT_DIR, dir => `${dir}/${PROJECT_JSON}`);
        for (const {content} of Object.values(files)) {
            try {
                const project = JSON.parse(content) as Project;
                if (project && project.id && project.title && project.description) {
                    // Being in this folder is what says a project was not put away, so a date found
                    // here is one the folder has outlived: a project moved back by hand is a project
                    // again, and the date left in its file would otherwise take it off the board the
                    // next time an agent touched it. Same for a folder an interrupted archive left
                    // behind, where the date reached the file and the move never happened.
                    delete project.archivedAt;
                    project.priority = project.priority || 'low';
                    project.tasks = project.tasks || {};
                    this.ensureTaskIds(project.tasks);
                    Object.assign(project, this.calculateProjectTaskInfo(project.tasks));
                    this.projects[project.id] = project;
                }
            } catch {
                // TODO: Handle error
                continue;
            }
        }
    }

    /**
     * A project written before tasks had an id was keyed by the title, and everything pointing at a
     * task held that title too. Taking the key as the id leaves every one of those references
     * pointing where it always did, so the record needs no rewriting to be read the new way.
     */
    private static ensureTaskIds(tasks: Record<string, Task>): void {
        for (const [key, task] of Object.entries(tasks)) {
            task.id = task.id || key;
        }
    }

    private static saveProject(projectId: string): void {
        const project = this.projects[projectId];
        if (!project) {
            throw new Error(`Project ${projectId} not found!`);
        }
        FileUtils.writeFile(`${PROJECT_DIR}/${project.id}/${PROJECT_JSON}`, JSON.stringify(project, null, 2));
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

    public static updateProject(projectInfo: UpdateContent<Omit<Project, "tasks">>, tasks?: Task[]): Project {
        const project = this.projects[projectInfo.id];
        if (!project) {
            throw new Error(`Project ${projectInfo.id} not found.`);
        }
        if (getProjectStatus(project) !== 'todo' && !!tasks) {
            throw new Error('Only projects in todo state can update tasks.')
        }
        // A report is of work that was done, and a project nobody has started yet has none to
        // report on: the same thing a task is held to before it goes ongoing. Refused before
        // anything is written, so a project turned away keeps the words it had.
        if (projectInfo.output && getProjectStatus(project) === 'todo') {
            throw new Error('Cannot set output when project is in todo state.');
        }
        if (tasks) {
            project.tasks = this.convertTasks(tasks);
        }
        // A report of the whole project outgrows a task report rather than the other way around, so
        // it is filed under a name of its own beside them. The kind of report it is names the file:
        // rewritten as the kind it was, it lands on the file the last one did; rewritten as another
        // kind it lands beside it, and the one before is left to go with the project.
        if (projectInfo.output) {
            fileAwayOutput(projectInfo.output, projectOutputDir(project.id), PROJECT_REPORT);
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
        if (new Set(tasks.map(task => task.id)).size < tasks.length) {
            throw new Error('There are duplicated task ids.');
        }
        if (tasks.length > PROJECT_CONFIG.maxTasksCount) {
            throw new Error('There are too many tasks.');
        }

        const taskObject = tasks.reduce((p, n) => {
            p[n.id] = n;
            return p;
        }, {} as Record<string, Task>);
        for (const task of Object.values(taskObject)) {
            for (const blockedBy of task.blockedBy) {
                if (!taskObject[blockedBy]) {
                    throw new Error('Invalid blocked task.');
                }
                taskObject[blockedBy].blocks.push(task.id);
            }
        }
        return taskObject;
    }

    public static createTask(taskInfo: TaskInitInfo): Task {
        if (taskInfo.steps?.length && taskInfo.steps?.length > PROJECT_CONFIG.maxTaskStepsCount) {
            throw new Error(`Too much steps for a task. Max is ${PROJECT_CONFIG.maxTaskStepsCount}.`);
        }
        const task: Task = {
            id: taskInfo.id,
            title: taskInfo.title,
            description: taskInfo.description,
            priority: taskInfo.priority,
            status: 'todo',
            assignee: taskInfo.assignee || taskInfo.agentId,
            blockedBy: taskInfo.blockedBy || [],
            blocks: [],
            stepsStatus: !taskInfo.steps?.length ? undefined : {
                steps: taskInfo.steps,
                currentStepIndex: -1
            }
        };
        return task;
    }

    public static updateTask(
        projectId: string, taskInfo: UpdateContent<Task>, steps?: string[]
    ): {task: Task, stop: boolean} {
        let task: Task | undefined;
        if (steps?.length && steps?.length > PROJECT_CONFIG.maxTaskStepsCount) {
            throw new Error(`Too much steps for a task. Max is ${PROJECT_CONFIG.maxTaskStepsCount}.`);
        }
        task = this.projects[projectId]?.tasks?.[taskInfo.id];
        if (!task) {
            throw new Error('Task not found.');
        }
        // The words on a task are only ever read, so they are free to change at any point of the
        // work. Blank ones are no rewrite though, they leave a task nobody can read off the board.
        for (const field of ['title', 'description'] as const) {
            if (taskInfo[field] !== undefined) {
                taskInfo[field] = taskInfo[field]?.trim() ?? '';
                if (!taskInfo[field]) {
                    throw new Error(`A task needs a ${field}.`);
                }
            }
        }
        // Work already taken up stays with whoever took it: a task handed on midway leaves the
        // subagent of the first agent running under a name the board no longer shows for it.
        if (taskInfo.assignee && taskInfo.assignee !== task.assignee && task.status !== 'todo') {
            throw new Error('Only a task still in todo can be handed to another agent.');
        }
        if (task.status === 'todo' && taskInfo.status === 'done' ||
            task.status === 'ongoing' && taskInfo.status === 'todo' ||
            task.status === 'done' && taskInfo.status && taskInfo.status !== 'done') {
            throw new Error('You can only update the status from todo to ongoing or from ongoing to done.');
        }
        if (taskInfo.status === 'done' && steps) {
            throw new Error('Cannot add steps and mark task done at the same time.');
        }
        if (taskInfo.status === 'done' && !this.isStepsCompleted(task)) {
            throw new Error('All steps should be completed before marking the task as done.');
        }
        if (task.status === 'todo' && !taskInfo.status && taskInfo.output) {
            throw new Error('Cannot set output when task is in todo state.');
        }
        if (!!task.pause && !task.verified && task.status !== 'done' && taskInfo.status === 'done' ) {
            taskInfo.status = task.status;
            task.verified = false;
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
        // The id both found this task and files it in the record, so it is no part of what a patch
        // may write: taken from here it would move the task off its own key, and nothing afterwards
        // would lead back to it.
        const {id, ...patch} = taskInfo;
        Object.assign(task, patch);
        // Only an output that just arrived is filed away. The one already on the task was filed
        // when it came in, and every later update of that task would file it over again.
        if (taskInfo.output) {
            fileAwayOutput(taskInfo.output, projectOutputDir(projectId), FileUtils.hashString(id));
        }
        if (!task.closedAt && taskInfo.status === 'done') {
            task.closedAt = new Date().toISOString();
        }
        const project = this.projects[projectId]!;
        if (!project.closedAt && Object.values(project.tasks).every(task => task.status === 'done')) {
            project.closedAt = new Date().toISOString();
        }
        Object.assign(project, this.calculateProjectTaskInfo(project.tasks));
        this.saveProject(project.id);
        return {task, stop: !!task.pause && task.verified === false};
    }

    public static updateCurrentStep(projectId: string, taskId: string, stepIndex: number): TaskStepsContext {
        const task = this.getTask(projectId, taskId);
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

    /**
     * Puts a project away: off the board, out of the list an agent is handed, and moved whole to
     * ARCHIVED_PROJECT_DIR under the id it had, with the date it was put away written into it.
     *
     * The folder moves rather than a flag being set, because where a project lies is a thing every
     * reader of the disk already agrees on: the live folder holds projects and nothing else, and
     * moving one back is the whole of restoring it -- tasks, chat, reports, and the paths those
     * reports are filed under, none of which had to be told. It leaves this map at the same time,
     * so the board, the list a run reads and every tool that reaches for a project by id are done
     * with it at once, and none of them has to remember to ask.
     *
     * The date goes in before the move, so the copy that lands carries it. Taken back off the
     * project if either step fails, so that a project archiving failed on is the project it was in
     * every respect: the date alone would be a thing to go off later, every write of a project
     * being a write of the whole of it, so the next unrelated task edit would carry it to disk. A
     * date that reached the file before a move that then failed is harmless for the same reason
     * `loadProjects` gives, and is gone with the next write either way.
     *
     * Whether an agent is working on it right now is not a thing this class can see, and a project
     * put away under a run would leave that run reaching for a project nobody has: the question is
     * asked where it can be answered, which is above this.
     */
    public static archiveProject(projectId: string): Project {
        const project = this.getProjectDetail(projectId);
        project.archivedAt = new Date().toISOString();
        try {
            this.saveProject(projectId);
            if (!FileUtils.movePath(`${PROJECT_DIR}/${projectId}`, `${ARCHIVED_PROJECT_DIR}/${projectId}`)) {
                throw new Error(`The folder of project ${projectId} went missing before it was archived.`);
            }
        } catch (error) {
            delete project.archivedAt;
            throw error;
        }
        delete this.projects[projectId];
        return project;
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
            completedTasks: Object.values(tasks).filter(task => task.status === 'done').map(task => task.id),
            ongoingTasks: Object.values(tasks).filter(task => task.status === 'ongoing').map(task => task.id),
            canStartTasks: Object.values(tasks).filter(task => task.status === 'todo' &&
                task.blockedBy.every(blockedBy => tasks[blockedBy]?.status === 'done')).map(task => task.id),
        };
    }

    public static getTask(projectId: string, taskId: string): Task | undefined {
        return this.projects[projectId]?.tasks[taskId];
    }

    /** Lets the ui redraw a project, to be called by whoever changed something in it. */
    public static fireProjectInfoEvent(projectId: string, context: OneLoopContext): void {
        context.actions.agentHandler.onInfoEvent({
            eventType: 'updateProject',
            content: this.getProjectDetail(projectId),
        });
    }

    public static promptManagementTools(): string {
        return `## Project Management tools
You can use project related tools to plan, manage projects.
Projects are considered long term goals that can be broken down into tasks, they will be persisted in file system.
Simple tasks are independent tasks and not related to any project when created,
but they'll be wrapped into a project after it's created and can be searched with get_project_list as the same as normal projects.
They will also be persisted in file system.

## Get project task info
You can get all projects info with get_project_list tool, and get detailed info of a project with get_project_detail tool.

## Create project and simple task
If you consider a job should be a project, use create_project tool to create it.
If one job is not big enough to be a project, you can directly create a simple task with create_simple_task without putting it into a project.
Always create a project/simple task if asked to do something, even if the user didn\'t explicitly ask you to create one.
You can create detailed steps for each task if needed,
steps info are important for user to get current task execution status, so make sure to update them in a timely manner.

## Update task status
Every task carries an id you gave it when it was created, and that id is how every tool reaches it.
The title beside it is what the user reads: they may rename a task at any time, so read a task by
its id and never by the words on it.
You can update a task with update_task tool and update the step index with update_task_current_step tool.
For simple tasks just set the wrapped project id.

## Report a finished project
A project closes itself once its last task is done. What it produced as a whole is no task report,
so write it with the update_project tool, in output: the user reads that off the project without
opening a task. A project wrapping a single task needs none, the task report is already the whole.`;
    }

    public static promptTaskDelegation(): string {
        return `## Run the tasks through subagents
You run this project, you do not work through its tasks yourself. Hand every task that is ready to
a subagent: call the task_loop tool with the id of the task, and the subagent works as the agent
the task is assigned to, with the description and the steps of it in front of it. It can split the
task among subagents of its own, so hand over the whole task rather than a piece of it.
Tasks that block nothing and wait for nothing can go out at the same time, one task_loop call each.
Handing a task over marks it ongoing; you mark it done once you accepted what came back, the
subagent itself only moves the step index inside the task.
Use sub_loop instead where there is nothing on the board to work on, for a question to look into or
a piece of work of your own.
A subagent can put a question to the user where only they can settle something, and it is asked in
this conversation as though you had asked it, with the work of that subagent standing still until
it is answered. Put everything you already know into the prompt you give it, so that what is asked
of the user is only ever what none of you knew, and keep the rest of the talking to them yours.`;
    }

    public static promptAssignedTask(projectId: string, taskId: string): string {
        const task = this.getTask(projectId, taskId);
        if (!task) {
            return '';
        }
        return `## You were assigned this single task, it is the only thing you work on:
${JSON.stringify({
    projectId,
    id: task.id,
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    steps: task.stepsStatus?.steps,
    currentStepIndex: task.stepsStatus?.currentStepIndex,
})}
Stay inside the scope of this task: do not pick up other tasks of the project and do not carry the
work further than the description asks for. If something outside the task turns out to be needed,
report it instead of doing it.${task.stepsStatus?.steps.length ? `
Keep the step index up to date with the update_task_current_step tool as you go through the steps.` : ''}
Close your run with a summary of what you did and what came out of it, that summary is what the
agent who assigned the task gets to see. If what the task produced is something to read, put it in
that summary whole rather than in a file of its own: the agent who assigned it has to hand the result
on, and it can only hand on what it was given.`;
    }

    public static promptCurrentProject(projectId: string): string {
        const project = this.projects[projectId];
        return `${project ? `## You are currently working on the project below:
${JSON.stringify({
    id: project.id,
    title: project.title,
    description: project.description,
    tasks: Object.values(project.tasks).map(task => ({
        id: task.id,
        title: task.title,
        description: task.description
    })),
    completedTasks: project.completedTasks,
    ongoingTasks: project.ongoingTasks,
    canStartTasks: project.canStartTasks,
})}
If the user does not specify another project, assume they are talking about this project.` : ''}`
    }
}
