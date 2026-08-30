import { FileUtils, UpdateContent } from '@deepclaw/node-utils';
import { ARCHIVED_PROJECT_DIR, PROJECT_DIR, PROJECT_JSON, projectOutputDir } from '../../paths';
import { type LLMTaskOutput, type Project, type Task, type TaskReview, type TaskStepsContext, isProjectStarted, MISSION_PRIORITIES, MissionPriority, PROJECT_CONFIG, slimProject } from '@deepclaw/core';
import { fileAwayOutput, readOutputContent } from '../../loop-utils';
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
    /** Whoever reads the task over before it closes, and nobody on nearly every task. */
    reviewer?: string;
};

/**
 * The words a project is known by, as they are worth writing down: cut to the length they are read
 * at, and refused where trimming leaves none.
 *
 * Neither of the two doors this comes through is a promise. The schema is a suggestion to a model,
 * which sends what it likes and is held to nothing but a `minLength: 1` three spaces satisfy; the
 * box on the board is one form of a server action, and the action is an endpoint anybody who
 * reaches the page can post to. So the rule the description is read under lives here, where both
 * doors open, and a project turned away keeps the words it had.
 */
function writableDescription(description: string | null): string {
    const words = (description ?? '').trim().slice(0, PROJECT_CONFIG.maxProjectDescriptionLength);
    if (!words) {
        throw new Error('A project needs a description.');
    }
    return words;
}

/**
 * One of the four words, on every way in. Written down, a fifth is read back by everything
 * downstream as a priority it has no colour, no name and no order for: the pill on the card comes
 * out blank, the list under it ticks nothing, and the label is the key it was looked up by.
 *
 * Asked here rather than at any door, because every door is a suggestion. A schema is what a model
 * is asked for and not what it sends; a card on the board is one form of a server action, and the
 * action is an endpoint anybody who reaches the page can post to. Both ends of a project reach
 * this, the plan a run writes and the pill a user picks, so the word is held to the four here.
 */
function writablePriority(priority: MissionPriority | null): MissionPriority {
    if (!priority) {
        throw new Error(`A priority is needed, one of ${MISSION_PRIORITIES.join(', ')}.`);
    }
    if (!MISSION_PRIORITIES.includes(priority)) {
        throw new Error(`A priority is one of ${MISSION_PRIORITIES.join(', ')}, not "${priority}".`);
    }
    return priority;
}

/**
 * The same four words on the way in from disk, where a word that is none of them is read as the
 * quietest rather than refused: a record already written is a record there is no turning away, and
 * a project the board cannot draw is worse to its owner than one whose pill reads low.
 *
 * There are such records. Nothing held a priority to the four until now, so anything a model once
 * wrote is on somebody's disk, and a file edited by hand comes through this door as readily. The
 * word goes back with the next write of the project like every other field read here.
 */
function readablePriority(priority: MissionPriority | undefined): MissionPriority {
    return priority && MISSION_PRIORITIES.includes(priority) ? priority : 'low';
}

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
                    project.priority = readablePriority(project.priority);
                    project.tasks = project.tasks || {};
                    this.ensureTaskIds(project.tasks);
                    this.ensureTaskPriorities(project.tasks);
                    Object.assign(project, this.calculateProjectTaskInfo(project.tasks));
                    this.ensureStartedAt(project);
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

    /**
     * A card is drawn from the task rather than from the project, so a word the board cannot draw
     * hurts here in the same way and is read the same way out.
     */
    private static ensureTaskPriorities(tasks: Record<string, Task>): void {
        for (const task of Object.values(tasks)) {
            task.priority = readablePriority(task.priority);
        }
    }

    /**
     * A project written before there was a button to start one carries no date, and work in it is
     * all there is to go by: a task ongoing or done is work somebody set going, whoever that was.
     * Read as unstarted, such a project would be one with subagents in it that no further task
     * could be handed to, and one the board offered to start over again.
     *
     * Asked here, once, and not everywhere the date is read, because a task being ongoing is
     * something a run can arrange: read at every gate, it would be a gate a run could open. Nothing
     * of a run has happened yet at load, so what this dates is only ever the old records it is for.
     * The date is the day the project was written, the record saying nothing of when work began,
     * and it goes to disk with the next write of the project like any other field.
     */
    private static ensureStartedAt(project: Project): void {
        if (!project.startedAt && (project.ongoingTasks.length || project.completedTasks.length)) {
            project.startedAt = project.createdAt;
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
            description: writableDescription(projectInfo.description),
            priority: writablePriority(projectInfo.priority),
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
        // The plan is settled by the user agreeing to it, so it is the date they agreed on that
        // closes it to rewriting and not the first task to move: those are a second apart, and a
        // list replaced in between is a list they never saw. Asked of the date rather than of the
        // status so that what is being asked is on the page -- the two read the same today, and
        // only one of them is the question.
        if (isProjectStarted(project) && !!tasks) {
            throw new Error('Only projects in todo state can update tasks.')
        }
        // A report is of work that was done, and a project nobody has started yet has none to
        // report on. Refused before anything is written, so a project turned away keeps the words
        // it had.
        if (projectInfo.output && !isProjectStarted(project)) {
            throw new Error('Cannot set output when project is in todo state.');
        }
        // Read before a word of this is written down, as the refusal in it is only a refusal while
        // nothing has been written: a project blanked and then turned away is blanked all the same.
        if (projectInfo.description !== undefined) {
            projectInfo.description = writableDescription(projectInfo.description);
        }
        if (projectInfo.priority !== undefined) {
            projectInfo.priority = writablePriority(projectInfo.priority);
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
            priority: writablePriority(taskInfo.priority),
            status: 'todo',
            assignee: taskInfo.assignee || taskInfo.agentId,
            // Nobody where nobody was named. A task falls back to whoever planned it for an
            // assignee, work being somebody's by definition, and a review is the other way round:
            // it is worth a run of its own on few enough tasks that no default could be right.
            reviewer: taskInfo.reviewer || undefined,
            // The same blocker named twice is the one wait. Left as two it is written twice over,
            // here and again in the blocks of what it waits for, and both are read back to whoever
            // asks for the project.
            blockedBy: Array.from(new Set(taskInfo.blockedBy || [])),
            blocks: [],
            stepsStatus: !taskInfo.steps?.length ? undefined : {
                steps: taskInfo.steps,
                currentStepIndex: -1
            }
        };
        return task;
    }

    /**
     * Puts a task on the board of a project that is still open. The list of a project is planned
     * up front and frozen where it stood the moment work began -- update_project may replace it
     * only until the user presses start -- so a task thought up midway had no way onto the board,
     * and this is that way: work that turned out to be needed is still work of the project, better
     * kept beside the tasks it came out of than in a project of its own nobody asked for.
     *
     * A task added waits behind the ones it names and never the other way round: what is already on
     * the board keeps the waits it was planned with, since nothing can write blockedBy onto a task
     * that already exists.
     *
     * A closed project takes no new tasks. Closing is what the work said of itself -- every task
     * done, nothing left to ask for -- and a task landing on that would unsay it, so what follows
     * on from closed work belongs in a project of its own. A project the user put away is out of
     * the map already and answers "not found" the same way.
     */
    public static addTask(projectId: string, taskInfo: TaskInitInfo): Task {
        const project = this.projects[projectId];
        if (!project) {
            throw new Error(`Project ${projectId} not found.`);
        }
        if (project.closedAt) {
            throw new Error('A closed project takes no new tasks.');
        }
        if (project.tasks[taskInfo.id]) {
            throw new Error(`There is a task "${taskInfo.id}" on this project already.`);
        }
        if (Object.keys(project.tasks).length >= PROJECT_CONFIG.maxTasksCount) {
            throw new Error('There are too many tasks.');
        }
        const task = this.createTask(taskInfo);
        // Every blocker is found before any of them is written to. The board being written on here
        // is the live one, so a task turned away halfway would leave the blockers it got past
        // waiting on a task that never landed. Nothing is saved on the way out, but every write of
        // a project is a write of the whole of it: the next unrelated task edit would carry them
        // to disk, and the project read back in the meantime says the same.
        const blockers = task.blockedBy.map(blockedBy => {
            const blocker = project.tasks[blockedBy];
            if (!blocker) {
                throw new Error('Invalid blocked task.');
            }
            return blocker;
        });
        blockers.forEach(blocker => blocker.blocks.push(task.id));
        project.tasks[task.id] = task;
        Object.assign(project, this.calculateProjectTaskInfo(project.tasks));
        this.saveProject(projectId);
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
        const project = this.projects[projectId]!;
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
        //
        // Work is somebody's by definition -- a task is created with whoever planned it where it
        // names nobody -- so a blank name is no handover and there is nothing for it to mean. Read
        // as "nothing was asked for" it would be worse than meaningless: the gate below opens on
        // whether a name was sent, and an empty one would walk past it and leave an ongoing task
        // with nobody on it, which is a task no run can be built for and none of the doors offer.
        if (taskInfo.assignee !== undefined) {
            taskInfo.assignee = taskInfo.assignee?.trim() ?? '';
            if (!taskInfo.assignee) {
                throw new Error('A task needs an assignee.');
            }
            if (taskInfo.assignee !== task.assignee && task.status !== 'todo') {
                throw new Error('Only a task still in todo can be handed to another agent.');
            }
        }
        // A reviewer is settled before the work rather than during it, the same as the assignee and
        // for a reason of its own: a reviewer named onto work already under way is a gate appearing
        // in front of a run that had planned its way to done without one, and one taken off midway
        // is a reading somebody was promised and never got. An empty word takes the reviewer off,
        // which is how both doors say "nobody" -- a picker with nothing picked in it, and a model
        // that has no way to send a field away.
        //
        // Both of them are asked whether a name was sent rather than whether it says anybody, and
        // the two part company on what an empty one means: an assignee cannot be nobody and is
        // refused above, a reviewer can and is taken off here. What a reviewer cleared off an
        // ongoing task would be is the gate itself gone -- done written with no verdict and no
        // waiver, nothing on the board to say the task was ever going to be read.
        if (taskInfo.reviewer !== undefined) {
            taskInfo.reviewer = taskInfo.reviewer?.trim() || undefined;
            if (taskInfo.reviewer !== task.reviewer && task.status !== 'todo') {
                throw new Error('Only a task still in todo takes a reviewer or gives one up.');
            }
        }
        if (taskInfo.priority !== undefined) {
            taskInfo.priority = writablePriority(taskInfo.priority);
        }
        // How soon the work is to be picked up, which is a question there is no asking of work that
        // was finished: the user is offered this on a card in todo and in ongoing and on no other,
        // and the same holds wherever else it is written from.
        if (taskInfo.priority && taskInfo.priority !== task.priority && task.status === 'done') {
            throw new Error('Only a task still to be worked takes a new priority.');
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
        // The gate the reviewer of a task is for. It stands here rather than in the tool that writes
        // a status, because every door that writes one comes through this service and a gate on one
        // of them is a gate the others walk around.
        //
        // Thrown rather than quietly turned back the way a pause is: a pause is waiting for a person
        // and there is nothing to tell the run to do about it, while this is a step the run takes
        // itself, so what it is handed is the name of the tool that takes it.
        //
        // The order is spelled out because the obvious call is the wrong one and loses work: a run
        // marking the task done writes the report in the same call, and this refuses that call
        // whole -- nothing of it reaches the task, the report included -- so the review that
        // follows reads a task with no report on it and goes looking for one that was thrown away a
        // moment ago. Written first and without a status, the report is on the board for the
        // reading.
        //
        // What is said is held to the task rather than to the call, because the call is not all
        // this service's to speak for: the tool hands the files of an output over before it gets
        // here, and those are over with by the time this throws.
        if (taskInfo.status === 'done' && task.reviewer && !task.review) {
            throw new Error(`This task is read over before it is done, and nothing of this call is `
                + `on the task. Put the report on the task first, with an update_task carrying the `
                + `output and no status: what "${task.reviewer}" reads is the task as the board has `
                + `it. Then call review_task, and mark the task done once the verdict is in, `
                + `whichever way it went.`);
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
        // A task leaving todo is the work of the project beginning, so the project is dated with it.
        // The start button is the user saying so before any of it moves, and every other way work
        // begins is somebody moving a task: a card taken up on the board, a task handed to a
        // subagent, a run taking one on itself at the user's asking. All of those come through here,
        // which is why the date is written here rather than at each of them, and why none of them
        // has to order two writes to keep the project and its tasks saying the same thing.
        //
        // Written after everything that could refuse the patch and before anything is saved: a
        // project started on the strength of an edit that never landed is started for good, nothing
        // putting that date back. And only the first one counts, the date being when the work began.
        if (task.status === 'todo' && taskInfo.status && taskInfo.status !== 'todo') {
            project.startedAt ??= new Date().toISOString();
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
        if (!project.closedAt && Object.values(project.tasks).every(task => task.status === 'done')) {
            project.closedAt = new Date().toISOString();
        }
        Object.assign(project, this.calculateProjectTaskInfo(project.tasks));
        this.saveProject(project.id);
        return {task, stop: !!task.pause && task.verified === false};
    }

    /**
     * The user closing a task off themselves, which the board offers on a card that is ongoing. Two
     * writes to whoever reads the record afterwards -- every step of it behind it, and the task done
     * -- and one save, a task whose steps are all marked and whose status is not being a task the
     * next run would set about finishing.
     *
     * The steps move first because the status is refused while any of them is unmarked, and they are
     * moved here rather than asked of the caller: how far the work got is the run's to say while it
     * is running, and this is the user saying the work is over, which leaves nothing half-marked
     * behind. A task carrying no steps at all is done on the word alone.
     *
     * Their click is also the verdict a paused task waits for. A pause holds the work at the gate
     * until somebody has looked at it, and somebody closing the task by hand has looked at it;
     * without this the status below would be quietly put back and the click would do nothing.
     *
     * The reading a reviewer owed it is waived the same way and for the same reason: the board is
     * not stricter than the service, and a person closing a task themselves is the reading. It says
     * so as it is -- waived, by nobody -- rather than filing a report nobody wrote.
     *
     * All of those are written on the live task before the status is asked for, which is the shape
     * updateTask has: what it reads when it decides whether the steps are done is the task and not
     * the patch. Refused, they would live on unsaved until some later edit of the project carried
     * them to disk -- a pause satisfied by nothing anybody did. So nothing that can refuse is left
     * after them: the status is checked above, and the two gates that read the task rather than the
     * patch -- the pause and the reading it owed -- are both satisfied here.
     */
    public static finishTask(projectId: string, taskId: string): Task {
        const task = this.getTask(projectId, taskId);
        if (!task) {
            throw new Error('Task not found.');
        }
        if (task.status !== 'ongoing') {
            throw new Error('Only a task being worked on can be marked done.');
        }
        if (task.stepsStatus?.steps.length) {
            task.stepsStatus.currentStepIndex = task.stepsStatus.steps.length;
        }
        if (task.pause) {
            task.verified = true;
        }
        if (task.reviewer && !task.review) {
            task.review = {verdict: 'waived', at: new Date().toISOString()};
        }
        return this.updateTask(projectId, {id: taskId, status: 'done'}).task;
    }

    /**
     * What the reviewer came back with, which is the one thing a review writes anywhere.
     *
     * The report is filed away under a name of its own rather than under the task's: an output over
     * the archiving threshold is written to a file named after what it belongs to, and a review
     * filed as the task would overwrite what the task itself produced -- quietly, and only for the
     * reports long enough to be filed, which is the worst of both.
     */
    public static submitReview(
        projectId: string, taskId: string, verdict: TaskReview['verdict'], output?: LLMTaskOutput
    ): Task {
        const task = this.getTask(projectId, taskId);
        if (!task) {
            throw new Error('Task not found.');
        }
        task.review = {by: task.reviewer, verdict, output, at: new Date().toISOString()};
        if (output) {
            fileAwayOutput(output, projectOutputDir(projectId), `${FileUtils.hashString(taskId)}-review`);
        }
        this.saveProject(projectId);
        return task;
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

    /**
     * The user setting the work of a project going. Everything that hands a task out reads this,
     * and until it is here a project is a plan being talked over.
     *
     * Pressed twice, the first date stands: what the second press would move is the moment the
     * work began, which is a thing that already happened. Whoever asks is told nothing of that --
     * a project that is started is started -- and the answer carries the project either way, the
     * date on it being what the browsers are told.
     */
    public static startProject(projectId: string): Project {
        const project = this.getProjectDetail(projectId);
        if (project.startedAt) {
            return project;
        }
        project.startedAt = new Date().toISOString();
        this.saveProject(projectId);
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

    /**
     * Lets the ui redraw a project, to be called by whoever changed something in it.
     *
     * The whole of it, tasks included: this is one project rather than all of them, so what it
     * costs does not grow with the board, and an open row is kept live by it without having to ask
     * again on every step. The count goes along because a row that never opened holds only that.
     */
    public static fireProjectInfoEvent(projectId: string, context: OneLoopContext): void {
        context.actions.agentHandler.onInfoEvent({
            eventType: 'updateProject',
            content: slimProject(this.getProjectDetail(projectId)),
        });
    }

    /**
     * What every run hears: reading the board, and putting a project on it. Nothing here writes to
     * a project that exists, which is the line the tools themselves are drawn on -- see the roles
     * they declare. A project is born in whatever conversation the user asked for it in, and from
     * the moment it exists it has a run of its own, which is where it is worked and rewritten.
     */
    public static promptManagementTools(): string {
        return `## Project Management tools
You can use project related tools to plan, manage projects.
Projects are considered long term goals that can be broken down into tasks, they will be persisted in file system.
A job too small to break down is a project of a single task, which is planned, started and reported
like any other: work lives in a project or nowhere.

## Get project task info
You can get all projects info with get_project_list tool, and get detailed info of a project with get_project_detail tool.

## Create a project
Use the create_project tool.
Always create a project if asked to do something, even if the user didn\'t explicitly ask you to create one.
You can create detailed steps for each task if needed, steps info are what the user watches the work
by.
A project has a conversation of its own from the moment it exists, on its row of the board. The
project you just made is gone over and worked there rather than in the conversation you made it in:
say where it is, and leave the plan to the user to open and change.`;
    }

    /**
     * The rest of it, for the run of the project alone. Every tool named here writes to a board
     * that is live -- a task added, a status moved, the report of the whole -- and the run of a
     * project is the only one that can see what else is on it: what has been handed out, what is
     * being read over, what a pause is waiting for. Said to a run without the tools, this would be
     * an invitation to call what it has not got.
     */
    public static promptBoardTools(): string {
        return `## Add a task to a project underway
The work itself finds what the plan left out. Where a project turns out to need another task, add
it with add_task: it goes on the board beside the ones planned, and waits behind whatever it is
blocked by. It only ever waits, never the other way round -- a task already on the board cannot be
made to wait for it -- so work the rest of the board turns out to need is work to do first rather
than a task to add in front of them. A project takes new tasks only while it is open, so once it
closed, the work that follows on from it belongs in a project of its own.

## Update task status
Every task carries an id you gave it when it was created, and that id is how every tool reaches it.
The title beside it is what the user reads: they may rename a task at any time, so read a task by
its id and never by the words on it.
You can update a task with update_task tool and update the step index with update_task_current_step tool.

## Rewrite the plan
The task list of this project can be replaced with update_project while the user has not started it
yet. Once they press start it is settled, and a task the work turns out to need goes on with add_task.

## Report a finished project
A project closes itself once its last task is done. What it produced as a whole is no task report,
so write it with the update_project tool, in output: the user reads that off the project without
opening a task. A project of a single task needs none, the task report is already the whole.`;
    }

    /**
     * Said the same way to every project run, started or not, so that the standing prompt of a run
     * is the same string before and after the user presses start. Which of the two a project is
     * stands with the project itself, in `promptCurrentProject`, where everything else that changes
     * under a run is said.
     */
    public static promptTaskDelegation(): string {
        return `## Run the tasks through subagents
A project is planned first and worked after, and the word between the two is the user's: they press
start on the board, or they tell you to get going. Until one of those, nothing of the plan is handed
out and no task of it is marked ongoing, and the plan is what there is to work on with them. What
follows is how a project runs from the moment it is going.
You run this project, you do not work through its tasks yourself. Hand every task that is ready to
a subagent: call the task_loop tool with the id of the task, and the subagent works as the agent
the task is assigned to, with the description and the steps of it in front of it. It can split the
task among subagents of its own, so hand over the whole task rather than a piece of it.
Tasks that block nothing and wait for nothing can go out at the same time, one task_loop call each.
Handing a task over marks it ongoing; you mark it done once you accepted what came back, the
subagent itself only moves the step index inside the task.
Where the user asks you to work a task yourself, that is theirs to ask and you do it. Say so with
work_on_task before you begin: that marks the task ongoing and puts you on their board as the one
on it, and the card shows it running while you are answering. Say it again in a later turn that
takes the work back up. Mark it done when the work is over, the same as for one you handed out.
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
on, and it can only hand on what it was given.${task.reviewer ? `
This task is read over by "${task.reviewer}" before it closes. When every step is marked and the
work is as done as you can make it, write the summary you mean to close with and pass it whole in
the prompt of review_task, along with where the work landed. Nothing of it is on the board yet --
the task carries a report only once you have reported back -- so that prompt is the only place the
reviewer can read what you did, and a review asked for before you have written it is a review of
the files alone. Fixing what comes back is yours to do while the work is still in your hands: once
you report back, a fix is a whole new run in somebody else's context. Call it again when you have
fixed things, with the summary brought up to date; if the two of you cannot agree, report back with
what stands and what was said.` : ''}`;
    }

    /**
     * The verdict as the run that has to act on it reads it: whoever called for the review, and the
     * loop that handed the task out, which is told what stands whether or not it was the one that
     * asked. Nothing where there is nothing to hand on -- a task nobody read, and a task the user
     * closed themselves, which carries the note that there was no reading rather than a verdict.
     *
     * Dated, because the gate is open from the first verdict on: `reviewer && !review` stops
     * holding the moment one lands, so a task that was rejected, handed out again and fixed closes
     * without anybody reading the fix. The record is right and the reading is old, and the two are
     * only told apart by when it was made -- so the time is in the words, next to a line saying
     * what to do where the work has moved since. It is worth knowing that this is all there is:
     * nothing checks what the verdict was made against, and a second reading happens because a run
     * asked for one.
     */
    public static promptTaskVerdict(projectId: string, taskId: string): string {
        const task = this.getTask(projectId, taskId);
        const review = task?.review;
        if (!task || !review || review.verdict === 'waived') {
            return '';
        }
        const said = review.verdict === 'passed' ? 'passed the work' : 'rejected the work';
        // Read back out of the file where a long report lies. What a report says is the whole of
        // what this hands on, and the reports worth reading are the ones long enough to be filed.
        const report = review.output && readOutputContent(review.output);
        return `"${review.by ?? task.reviewer}" read "${task.title}" over at ${review.at} and ${said}:
${report || '(the verdict came with no report)'}

A verdict is advice and not a gate: the task closes either way once one is in. What was found is
yours to see to, or to say to the user where you think the reviewer is wrong.
This one is about the work as it stood at that moment, and it is the only reading the task needs to
close from here. So where the work has changed since -- a rejection seen to, the task picked up
again -- what stands now has been read by nobody: bring the report of the task up to what it now
says, then call review_task once more before you close it.`;
    }

    /**
     * The task as the run reading it over is given it, which is the same task worded for somebody
     * who is not going to work on it. What the work produced is in here where there is any: the
     * board carries it once the task reports back, and a review called before that reads what is
     * in the workspace and what the run that called for it said in the prompt.
     */
    public static promptTaskUnderReview(projectId: string, taskId: string): string {
        const task = this.getTask(projectId, taskId);
        if (!task) {
            return '';
        }
        return `## This is the task you are reading over. You did not work it:
${JSON.stringify({
    projectId,
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    steps: task.stepsStatus?.steps,
    // Read back the same way the verdict is, and for the same reason: a run handed the sentinel
    // in place of what the work produced is handed a url it cannot follow.
    output: task.output && {...task.output, content: readOutputContent(task.output)},
    workedBy: task.assignee,
})}
What the task asked for is the whole of what the work is answered against: work that does what the
description asks for passes, whatever else you would have done differently. Read the rest of the
project with get_project_detail where the task leans on something outside itself.${task.output ? ''
: `
The task carries no output, and that is not something missing: a task is given one when it reports
back, and this one is still under way. The account of the work is in the prompt you were handed --
read it as the account and not as the finding, and check it against the workspace. There is nothing
else of it to look for and nobody to ask for it.`}
Your verdict goes to whoever asked for this review, and your report is kept on the task for the
user to read.`;
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
})}${isProjectStarted(project) ? '' : `
The user has not started this project yet: nothing of it is handed to anybody or marked ongoing
until they press start or tell you to begin, and what there is to do with it meanwhile is to go
through the plan with them.`}
If the user does not specify another project, assume they are talking about this project.` : ''}`
    }
}
