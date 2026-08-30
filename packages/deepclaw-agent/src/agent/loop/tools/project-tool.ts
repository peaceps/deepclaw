import { DEFAULT_LOOP_KINDS, ToolDesc } from "../../definitions/tool-definitions";
import { ProjectManager } from "../services/project-manager";
import {
    type LLMTaskOutput, MISSION_PRIORITIES, type MissionPriority, type MissionStatus,
    PROJECT_CONFIG, type Project, type Task
} from "@deepclaw/core";
import { OneLoopContext } from '../../definitions/definitions';
import { i18nInstance } from "@deepclaw/i18n";
import { UpdateContent } from "@deepclaw/utils";
import { AgentIdentityManager } from "../services/agent-identity-manager";
import { fireRunningTasksEvent, RunningTaskService } from "../services/running-task-service";
import { EXT_DESCRIPTION, keptOutput, MAX_GENERATED_FILES, publishGeneratedFiles, requireReadableOutput, skippedFilesNote } from "../../loop-utils";
import { projectFilesDir } from "../../paths";

/** Where the report of a task stood in an answer that is not the one to ask for it. */
const OUTPUT_KEPT = '<Output kept, read it with get_project_detail>';

/** The project as an answer to a write of it, with what it and its tasks produced left out. */
function projectAfterWrite(project: Project): string {
    const tasks: Record<string, Task> = {};
    for (const [id, task] of Object.entries(project.tasks)) {
        tasks[id] = task.output ? {...task, output: keptOutput(task.output, OUTPUT_KEPT)} : task;
    }
    const output = project.output && keptOutput(project.output, OUTPUT_KEPT);
    return JSON.stringify({...project, output, tasks});
}

/**
 * A project closes the moment its last task does, which is no occasion of its own: nothing after it
 * asks the run for a word on the whole of it, and by the next turn there may be no run left to ask.
 * Said here, where the closing happened, the project is still in front of whoever closed it. It
 * keeps being said until the report is written, since every later write is another such moment.
 */
function reportReminder(project: Project): string {
    if (!project.closedAt || project.output) {
        return '';
    }
    // A report of the whole of one task is the report of that task written twice.
    if (Object.keys(project.tasks).length < 2) {
        return '';
    }
    return `

Every task of this project is done, so the project is closed and nothing further will be asked of
it. What is missing is the report of the project itself: write it now with update_project, in
output. The user reads it off the project without opening a task.`;
}

type ProjectTaskInput = {
    id: string;
    title: string;
    description: string;
    priority: MissionPriority;
    steps?: string[];
    blockedBy?: string[];
    assignee?: string;
    reviewer?: string;
};

/** A handle rather than a sentence: lowercase, no spaces, nothing that needs escaping anywhere. */
const TASK_ID_PATTERN = '^[a-z0-9][a-z0-9_-]*$';

const taskIdSchema = {
    type: 'string',
    description: `How every tool reaches this task from now on, unique across the tasks of
this project. Give it a short lowercase handle of what the task is about, "design" or "api-schema".
The user never sees it and it never changes, which is what makes it safe to hold on to: the title
beside it is theirs to rewrite whenever they like.`,
    minLength: 1,
    maxLength: 30,
};

/**
 * Worded to be turned down. A reviewer costs a run of its own and a model handed a field will fill
 * it in, so what this says is mostly the cases where the answer is nobody -- and the two of those
 * are the ones a plan is full of: work the next task would trip over, and work the user reads.
 */
const reviewerSchema = {
    type: 'string',
    description: `The id of an agent that reads this task over before it closes. Leave it out for
almost every task. A review is another agent reading the work with fresh eyes and it costs a run of
its own, so it earns its place only where nothing else would catch a mistake: work no later task
would trip over, a change that is hard to take back, an answer that is either right or wrong and can
be checked against something. Where the user reads the result themselves, or where the next task
would fail loudly on a bad one, that is the review already and this stays empty.`,
};

const taskItemSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        id: {...taskIdSchema, pattern: TASK_ID_PATTERN},
        title: {
            type: 'string',
            description: 'The title of the task, will display to the user.',
            minLength: 1,
            maxLength: PROJECT_CONFIG.maxTaskTitleLength,
        },
        description: {
            type: 'string',
            description: 'A short description of the task, will display to the user.',
            minLength: 1,
            maxLength: PROJECT_CONFIG.maxTaskDescriptionLength,
        },
        priority: {
            type: 'string',
            enum: [...MISSION_PRIORITIES],
            description: 'The priority of the task.'
        },
        steps: {
            type: 'array',
            items: {type: 'string'},
            description: `The detailed steps to complete the task. Max step count is ${PROJECT_CONFIG.maxTaskStepsCount}.
You can update the current step index of the task via update_task_current_step tool when task is ongoing to keep track of the progress. 
All steps should be done when task is going to be marked as done.`,
            maxItems: PROJECT_CONFIG.maxTaskStepsCount,
        },
        blockedBy: {
            type: 'array',
            items: {type: 'string'},
            description: 'The ids of the tasks that this task is blocked by.'
        },
        assignee: {
            type: 'string',
            description: `The id of the agent that has to work on this task, pick the one whose role and
expertises fit it. The subagent you hand the task over to works as its assignee, with the memory and
the skills of that agent; left out, the task is yours, and the subagent that works it stands for you.`,
        },
        reviewer: reviewerSchema,
    },
    required: ['id', 'title', 'description', 'priority'],
};

/**
 * The same task on its way back through update_project. A task coming through here was copied out
 * of the project detail rather than thought up, so where create_project spells a field out for
 * somebody inventing one, this schema keeps the single line it takes to recognise it and leaves the
 * spelling out there: a schema is read on every turn, and these three fields were read twice.
 *
 * The id is free of the shape asked of a new one as well. A project made before ids were handed out
 * wears the old task title as its id, and a handle demanded here would leave the model no way to
 * bring such a task back as it is.
 */
const keptTaskItemSchema = {
    ...taskItemSchema,
    properties: {
        ...taskItemSchema.properties,
        id: {
            ...taskIdSchema,
            description: `The id this task already has, copied over from the project detail, or a
short lowercase handle of what it is about for a task being added.`,
        },
        steps: {
            ...taskItemSchema.properties.steps,
            description: `The detailed steps to complete the task. Max step count is ${PROJECT_CONFIG.maxTaskStepsCount}.`,
        },
        assignee: {
            ...taskItemSchema.properties.assignee,
            description: `The id of the agent that has to work on this task, left out for the task to
stay yours and be worked by a subagent standing for you.`,
        },
    },
};

/**
 * An id that belongs to nobody would hand the task to a name the company does not know: the
 * subagent working on it would run as a stranger and its work would be filed under one as well.
 */
function requireHiredAssignee(assignee: string | undefined): void {
    if (!assignee) {
        return;
    }
    const agent = AgentIdentityManager.getAgent(assignee);
    if (agent && !agent.fired) {
        return;
    }
    const hired = AgentIdentityManager.getAgents().filter(one => !one.fired).map(one => one.id);
    throw new Error(`No agent "${assignee}" works here, assign the task to one of: ${hired.join(', ')}.`);
}

/**
 * The same for the other name a task can carry, and turned away here rather than at the gate: a
 * reviewer nobody can be built for is a task that can never be closed by any run, only waived by
 * the user's own hand on the board.
 */
function requireHiredReviewer(reviewer: string | undefined): void {
    if (!reviewer) {
        return;
    }
    const agent = AgentIdentityManager.getAgent(reviewer);
    if (agent && !agent.fired) {
        return;
    }
    const hired = AgentIdentityManager.getAgents().filter(one => !one.fired).map(one => one.id);
    throw new Error(`No agent "${reviewer}" works here, pick a reviewer from: ${hired.join(', ')}.`);
}

/**
 * The other half of `roles: ['project']`, and the half that carries the weight. The role says the
 * caller is the run of a project; this says it is the run of *this* project. Without it the board
 * of every project is open to the run of every other one -- get_project_list hands out the ids to
 * anybody, so "mark t1 of that other project done" is a thing a run can be talked into and has no
 * way to refuse.
 *
 * It is what makes the rest of it true. The runs on a task are kept per project and per task, and
 * every question asked of them -- is somebody working this, is somebody reading it -- is answered
 * on the quiet assumption that the runs which could be there are this project's own. A second
 * project's run writing here would be a hand nothing counted.
 *
 * Read off the session rather than taken as an argument, which is the whole point: a run cannot
 * name a project it is not in, because it never names the one it is in either.
 */
function requireOwnProject(projectId: string, context: OneLoopContext): void {
    if (projectId === context.projectId) {
        return;
    }
    throw new Error(`This conversation is the conversation of project ${context.projectId}, and `
        + `${projectId} is another project. Its board is worked in its own conversation, on its `
        + 'own row: tell the user which project the work belongs to and leave it there.');
}

function buildTasks(tasks: ProjectTaskInput[], context: OneLoopContext): Task[] {
    return tasks.map(task => {
        requireHiredAssignee(task.assignee);
        requireHiredReviewer(task.reviewer);
        return ProjectManager.createTask({...task, agentId: context.agentId});
    });
}

type CreateProjectInput = {
    title: string;
    description: string;
    priority: MissionPriority;
    tasks: ProjectTaskInput[];
};

export const createProjectTool: ToolDesc<CreateProjectInput> = {
    tool: {
        name: 'create_project',
        description: `Create a new project with its tasks. project is a long term goal that can be broken down into tasks,
they will be persisted in file system. The project gets a conversation of its own on the board the
moment it exists, and the plan is reviewed and changed there rather than here: say where it is and
leave it to the user.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                title: {
                    type: 'string',
                    description: 'The title of the project, will display to the user.',
                    minLength: 1,
                    maxLength: 50,
                },
                description: {
                    type: 'string',
                    description: 'A short description of the project, will display to the user.',
                    minLength: 1,
                    maxLength: PROJECT_CONFIG.maxProjectDescriptionLength,
                },
                priority: {
                    type: 'string',
                    enum: [...MISSION_PRIORITIES],
                    description: 'The priority of the project.'
                },
                tasks: {
                    type: 'array',
                    items: taskItemSchema,
                    maxItems: PROJECT_CONFIG.maxTasksCount,
                },
            },
            required: ['title', 'description', 'priority', 'tasks'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: false,
    loopKinds: ['main'],
    // The one tool of the board open to every role, and it has to be: a project is born here, and
    // the run of a project is a thing that exists only once there is one. So this is the chat the
    // user asked for it in, whatever that chat was. Everything after it -- rewriting the plan,
    // putting a task on, moving one along -- belongs to the run of the project, which the project
    // has from the moment this call returns.
    invoke: async function(input: CreateProjectInput, context: OneLoopContext): Promise<string> {
        const tasks = buildTasks(input.tasks, context);
        const project = ProjectManager.createProject({
            agentId: context.agentId,
            title: input.title,
            description: input.description,
            priority: input.priority
        }, tasks);
        
        ProjectManager.fireProjectInfoEvent(project.id, context);
        context.runtime.agentBreakReason = 'projectCreated';
        return `Project created successfully.
Here's the project info:
${projectAfterWrite(project)}`;
    },
}

type AddTaskInput = ProjectTaskInput & {
    projectId: string;
};

export const addTaskTool: ToolDesc<AddTaskInput> = {
    tool: {
        name: 'add_task',
        description: `Add one task to a project that is not closed. The whole task list can only be
replaced with update_project while the project is still todo, and the work itself keeps finding
what the plan left out: a follow-up nobody saw coming, a gap a finished task uncovered. This puts
such a task on the board, where it waits behind the tasks it names in blockedBy like one planned
from the start. It cannot be put in front of anything: a task already on the board keeps the waits
it was planned with, so a prerequisite found late is work to do first rather than a task to add.
A closed project takes no new tasks -- open the work that follows on from it in a project of its
own instead.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                projectId: {type: 'string', description: 'The ID of the project.'},
                ...taskItemSchema.properties,
            },
            required: ['projectId', ...taskItemSchema.required],
        },
    },
    agentMode: ['agent'],
    parallelSafe: false,
    // The board of a project belongs to the loop that runs it: a subagent works a task it was
    // handed, it does not put tasks on the board of the project.
    loopKinds: ['main'],
    // And the board of a project belongs to the run of that project, which is the other half of
    // the same sentence. What this one reaches is a live board -- a project still being planned
    // has its whole task list rewritten with update_project instead -- so it is asked for by a run
    // that can see what else is on that board.
    roles: ['project'],
    invoke: async function(input: AddTaskInput, context: OneLoopContext): Promise<string> {
        requireOwnProject(input.projectId, context);
        requireHiredAssignee(input.assignee);
        requireHiredReviewer(input.reviewer);
        const {projectId, ...task} = input;
        ProjectManager.addTask(projectId, {...task, agentId: context.agentId});
        ProjectManager.fireProjectInfoEvent(projectId, context);

        // No report reminder here: it speaks for a closed project, and a closed one takes no tasks.
        const project = ProjectManager.getProjectDetail(projectId);
        return `Task added successfully.
Here's the related info:
${projectAfterWrite(project)}`;
    }
};

type UpdateProjectInput = {
    projectId: string;
    title?: string;
    description?: string;
    priority?: MissionPriority;
    output?: LLMTaskOutput;
    tasks?: ProjectTaskInput[];
};

export const updateProjectTool: ToolDesc<UpdateProjectInput> = {
    tool: {
        name: 'update_project',
        description: `Update project info, tasks can only be updated when a project is in todo state.
The report of the finished project goes here as well, in output.
A task that has to join a project already underway goes in with add_task instead.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                projectId: {type: 'string', description: 'The ID of the project.'},
                title: {
                    type: 'string',
                    description: 'The title of the project, will display to the user.',
                    minLength: 1,
                    maxLength: 50,
                },
                description: {
                    type: 'string',
                    description: 'A short description of the project, will display to the user.',
                    minLength: 1,
                    maxLength: PROJECT_CONFIG.maxProjectDescriptionLength,
                },
                priority: {
                    type: 'string',
                    enum: [...MISSION_PRIORITIES],
                    description: 'The priority of the project.'
                },
                output: {
                    type: 'object',
                    additionalProperties: false,
                    description: `The report of the project as a whole, what the user reads to learn
how the work went without opening a single task. Write it once the project is finished: what was
asked for, what came of it, what is worth knowing before using it, and anything left undone. It is
no list of the task reports, those the user can already read one by one; it is what none of them
can say. A file the project produced is handed over from the task that produced it, in
generatedFiles of update_task.`,
                    properties: {
                        type: {
                            type: 'string', enum: ['markdown', 'text'],
                            description: 'Type of the project report.'
                        },
                        content: {
                            type: 'string',
                            description: `Content of the project report, what the user reads of it.
Large content is filed away for you, so there is no size to work around.`
                        },
                        ext: {type: 'string', description: EXT_DESCRIPTION},
                    },
                    required: ['type', 'content'],
                },
                tasks: {
                    type: 'array',
                    description: `The full task list of the project, it replaces the one there is.
Every task you are keeping must come back carrying the exact id it already has, copied over from
the project detail. An id you invent for a task that already exists does not rename it, it throws
the old one away along with everything pointing at it. Leave a task out only to delete it.`,
                    items: keptTaskItemSchema,
                    maxItems: PROJECT_CONFIG.maxTasksCount,
                },
            },
            required: ['projectId'],
        }
    },
    agentMode: ['agent'],
    parallelSafe: true,
    loopKinds: ['main'],
    // The plan of a project and the report of it, both of them the project's own to write. A chat
    // that knows the id knows nothing else: not what the tasks came out of, not what the runs on
    // them found, not what the report is a report of.
    roles: ['project'],
    invoke: async function(input: UpdateProjectInput, context: OneLoopContext): Promise<string> {
        requireOwnProject(input.projectId, context);
        // What arrives here is held to the schema above by nothing: additionalProperties is a word
        // only some providers keep, and a call carrying one field more is a call like any other by
        // the time it lands. So what a run may write is copied over one field at a time, the way
        // update_task does, rather than swept into a patch. A project carries dates that are the
        // user's word and no run's -- startedAt is the whole of what the start button means -- and
        // the surest way for a run not to reach them is for this to name what it can reach.
        const projectInfo: UpdateContent<Omit<Project, 'tasks'>> = {id: input.projectId};
        if (input.title) projectInfo.title = input.title;
        if (input.description) projectInfo.description = input.description;
        if (input.priority) projectInfo.priority = input.priority;
        if (input.output) {
            requireReadableOutput(input.output);
            projectInfo.output = input.output;
        }
        const projectTasks = input.tasks && buildTasks(input.tasks, context);
        const project = ProjectManager.updateProject(projectInfo, projectTasks);
        ProjectManager.fireProjectInfoEvent(input.projectId, context);
        return `Project updated successfully.
Here's the project info:
${projectAfterWrite(project)}${reportReminder(project)}`;
    }
}

type UpdateTaskInput = {
    projectId: string;
    taskId: string;
    title?: string;
    description?: string;
    status?: MissionStatus;
    steps?: string[];
    assignee?: string;
    reviewer?: string;
    /** generatedFiles names what to hand over to the user, it is no part of the kept output. */
    output?: LLMTaskOutput & {generatedFiles?: string[]};
};

export const updateTaskTool: ToolDesc<UpdateTaskInput> = {
    tool: {
        name: 'update_task',
        description: 'Update the status of a task in a project.',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                projectId: {type: 'string', description: 'The ID of the project.'},
                taskId: {type: 'string', description: 'The id of the task.'},
                title: {
                    type: 'string',
                    description: `A new title for the task, when the words on it no longer say what
it is. Nothing points at a task by its title, so renaming one costs nothing at any point of the work.`,
                    minLength: 1,
                    maxLength: PROJECT_CONFIG.maxTaskTitleLength,
                },
                description: {
                    type: 'string',
                    description: `A new description for the task, when what it asks for turned out
to be something else. Rewriting it is free at any point of the work, the same as the title.`,
                    minLength: 1,
                    maxLength: PROJECT_CONFIG.maxTaskDescriptionLength,
                },
                status: {
                    type: 'string', enum: ['todo', 'ongoing', 'done'],
                    description: `The executable status of the task.
'todo' is the initial status, 'ongoing' is the status when the task is being worked on,
'done' is the status when the task is completed. You can only update the status to the next status.
A task leaves todo only once the user has started the project it belongs to, whether you work it
yourself or hand it to somebody: until they say so, the plan is there to be talked over and nothing
in it is under way.
Both ways of starting a task mark it ongoing on their own -- task_loop hands it to a subagent,
work_on_task takes it on yourself -- so what is left to write here is done.`,
                },
                steps: {
                    type: 'array',
                    items: {
                        type: 'string',
                    },
                    description: `The steps to update, it can be set when a task is in todo status, or when there is no steps in an ongoing task.
They shoudl be short descriptions of each step, should not be too long for user to read.`,
                    maxItems: PROJECT_CONFIG.maxTaskStepsCount,
                },
                assignee: {
                    type: 'string',
                    description: `The id of the agent the task is assigned to, it works on the task
through a subagent that stands for it. Only a task still in todo can be handed on: work already
taken up stays with whoever took it.`,
                },
                reviewer: {
                    ...reviewerSchema,
                    description: `${reviewerSchema.description}
An empty string takes the reviewer a task has back off it. Only a task still in todo takes one or
gives one up: once the work is under way, the reading it was promised stands.`,
                },
                output: {
                    type: 'object',
                    additionalProperties: false,
                    description: `The output of the task. Whatever the user can just read -- a report,
a summary, a plan, a table -- belongs in the content itself, never saved to a file and handed over
as the path to it: a path is nothing they can open. A file the task really produced goes in
generatedFiles instead, and reaches them as a link. Name a path only for what neither can carry:
the source dir of a coding task, or the address of a dev server you started.`,
                    properties: {
                        type: {
                            type: 'string', enum: ['markdown', 'text'],
                            description: 'Type of the task output.'
                        },
                        content: {
                            type: 'string',
                            description: `Content of the task output, what the user reads of it.
Large content is filed away for you, so there is no size to work around.`
                        },
                        ext: {type: 'string', description: EXT_DESCRIPTION},
                        generatedFiles: {
                            type: 'array',
                            items: {type: 'string'},
                            maxItems: MAX_GENERATED_FILES,
                            description: `The files this task produced, by their path in the
workspace, each linked at the end of the content. One in the files folder of the project is handed
over as it lies, one from anywhere else is copied in there first. A picture is shown in the output
rather than linked under it. Only files, not folders, and only inside the workspace.`
                        }
                    },
                    required: ['type', 'content'],

                }
            },
            required: ['projectId', 'taskId'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: false,
    // A task waiting to be verified stops the loop that marks it done, and a sub loop that stops
    // there reports the pause instead of its work. Its status belongs to whoever assigned it.
    loopKinds: ['main'],
    // The state of a task is the project's own to move, and the run of that project is the only
    // one that knows what else is happening on the board: what is handed out, what is being read
    // over, what the pause is waiting for. A chat that happens to know the id knows none of it.
    roles: ['project'],
    invoke: async function(input: UpdateTaskInput, context: OneLoopContext): Promise<string> {
        requireOwnProject(input.projectId, context);
        const taskInfo: UpdateContent<Task> = {id: input.taskId};
        requireHiredAssignee(input.assignee);
        requireHiredReviewer(input.reviewer);
        // Both asked whether the field was sent rather than whether it says anybody, and the two
        // mean different things by an empty one. A task has to belong to somebody, so a blank
        // assignee is nothing anybody could have meant and the service turns it away -- passed on
        // rather than dropped here, a model that sent one is told so instead of watching a call
        // report success and change nothing. A blank reviewer is how a reviewer is taken off; read
        // as "nothing was asked for", a model that had named the wrong one on a todo task could
        // only name a different one, and the task would owe a reading for the rest of its life
        // that nobody but the user could waive by hand.
        if (input.assignee !== undefined) taskInfo.assignee = input.assignee;
        if (input.reviewer !== undefined) taskInfo.reviewer = input.reviewer;
        if (input.title) taskInfo.title = input.title;
        if (input.description) taskInfo.description = input.description;
        if (input.status) taskInfo.status = input.status;
        let skippedFiles: string[] = [];
        if (input.output) {
            const {generatedFiles, ...output} = input.output;
            requireReadableOutput(output);
            // The links go in before the output is filed away, so the saved report carries them,
            // which puts the files over before the service has said whether it takes the call. A
            // call it turns away leaves them in the project folder with nothing naming them; the
            // resend hands the same bytes over under the same names, so nothing is doubled where
            // the file has not changed since, and the links come back. Only the throw has to keep
            // to what it says: the task is untouched, the call is not.
            if (generatedFiles?.length) {
                skippedFiles = publishGeneratedFiles(
                    output, generatedFiles, projectFilesDir(input.projectId)
                ).skipped;
            }
            taskInfo.output = output;
        }
        const {task, stop} = ProjectManager.updateTask(input.projectId, taskInfo, input.steps);
        if (stop) {
            context.runtime.agentBreakReason = 'taskPause';
            // What the user is told about stands under the title they read, not the id they never see.
            context.runtime.agentBreakDetail = i18nInstance.t(
                'agent.agentBreak.agentStop.taskPause.user', {name: task.title}
            );
        }
        ProjectManager.fireProjectInfoEvent(input.projectId, context);

        const project = ProjectManager.getProjectDetail(input.projectId);
        let res = `Task updated successfully.
Here's the related info:
${projectAfterWrite(project)}`;
        if (stop) {
            res += `

Task is not set done because the user requires it to be verified before it can be marked done.
After user set task.verified to true, it can be successfully set done.`;
        }
        return res + reportReminder(project) + skippedFilesNote(skippedFiles);
    },
};

type WorkOnTaskInput = {
    projectId: string;
    taskId: string;
};

/**
 * The other way a task starts, task_loop being the usual one. Both mark it ongoing and both say who
 * is on it; the difference is whose hands, and this is the tool for the work the user asked of the
 * run itself.
 *
 * What it writes about the run lasts the turn it was said in and no longer. A subagent is a run from
 * its first line to its last, and the tool that spawns one holds it open across the await; a loop
 * working a task itself is answering one turn at a time, and between those turns nothing of it is
 * executing. So the turn is what this is scoped to, and a turn always ends: nothing said here can
 * be left behind by a conversation that wandered off, and the board never has to be read back to
 * find out whether it is still true. Said again next turn, if the run is still on the task.
 *
 * A task that is not done is a task this can be called on, and that is the whole of the gate. There
 * is no claim to be had on a task here, only the fact of who is working it: the two that could ever
 * reach a task are the run that owns the board and the subagent it handed the task to, and both of
 * them working it is both of them doing what they are for.
 *
 * No gate on a reading, where task_loop has one, and the difference is `parallelSafe` rather than
 * an oversight. There the two calls can leave the same turn -- task_loop and review_task are both
 * parallel safe, so they share a group and run beside each other, and a subagent set going under a
 * reading rewrites the very thing being read. This one is not parallel safe: it is planned into a
 * group of its own, groups run one after another, and a review_task of the same turn has therefore
 * already returned its verdict before this is called or has not been called yet. Nor can the two
 * arrive from different conversations any more -- the board of a project is written by the run of
 * that project alone, and one loop answers one turn at a time.
 *
 * Taking a task up sets the project going where the user had not started it themselves, work asked
 * of the run being work begun. That falls out of the write rather than being asked for here: a task
 * leaving todo is what dates a project, wherever the write comes from. The refusals worth having
 * are the ones updateTask makes anyway -- a task nobody can find, a done task going back to ongoing
 * -- so none of them is written twice here.
 */
export const workOnTaskTool: ToolDesc<WorkOnTaskInput> = {
    tool: {
        name: 'work_on_task',
        description: `Take one task on yourself, for work you are about to do. It marks the task
ongoing, the way handing it to a subagent with task_loop does, and puts you on the user's board as
the one on it while you answer. Say it again whenever you pick the work back up,
and mark the task done with update_task once it is over.
This is for a task the user asked you to work yourself. Every other task of a project goes to a
subagent with task_loop, which is how the board is normally worked.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                projectId: {type: 'string', description: 'The ID of the project.'},
                taskId: {type: 'string', description: 'The id of the task you are working on.'},
            },
            required: ['projectId', 'taskId'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: false,
    // The board of a project belongs to the loop that runs it, and one conversation works one task.
    loopKinds: ['main'],
    // The run of the project and no other, the same as task_loop. Both of them say who is working
    // a task, and a task worked by somebody outside the board is work the board cannot see: the
    // run that owns the project is the one that hands tasks out, waits on what comes back and
    // decides when one is done, and a hand it never knew about is a hand none of that accounts
    // for. A scheduled run with a project id is not that run, whatever it knows the id of.
    roles: ['project'],
    invoke: async function(input: WorkOnTaskInput, context: OneLoopContext): Promise<string> {
        requireOwnProject(input.projectId, context);
        const {task} = ProjectManager.updateTask(input.projectId, {
            id: input.taskId, status: 'ongoing',
        });
        RunningTaskService.startMainLoopRun(context.loopId, {
            projectId: input.projectId,
            taskId: task.id,
            agentId: context.agentId,
            startedAt: new Date().toISOString(),
        });
        fireRunningTasksEvent(context);
        ProjectManager.fireProjectInfoEvent(input.projectId, context);
        return `"${task.title}" is ongoing and yours to work. The user sees it running on the board
while this answer is being written; mark it done with update_task once the work is over.`;
    },
};

type UpdateTaskCurrentStepInput = {
    projectId: string;
    taskId: string;
    stepIndex: number;
};

export const updateTaskCurrentStepTool: ToolDesc<UpdateTaskCurrentStepInput> = {
    tool: {
        name: 'update_task_current_step',
        description: `Update the current step index of an ongoing task that is being worked on. This is used to keep track of the progress of the task.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                projectId: {type: 'string', description: 'The ID of the project.'},
                taskId: {type: 'string', description: 'The id of the task.'},
                stepIndex: {
                    type: 'number',
                    description: `The current step index of the ongoing task that is being worked on. 
The stepIndex starts from 0 and should be updated from small to large.
If all steps are done, set stepIndex to the length of steps, and then the task can be marked as done via update_task tool.`
                },
            },
            required: ['projectId', 'taskId', 'stepIndex'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: true,
    // The step index of a task belongs to the loop that works the task, and a sub loop of that
    // loop works a piece of it: two hands on the same index would only undo each other.
    loopKinds: ['main', 'task'],
    // Inside the project the task belongs to, like everything else that writes to the board.
    roles: ['project'],
    invoke: async function(input: UpdateTaskCurrentStepInput, context: OneLoopContext): Promise<string> {
        requireOwnProject(input.projectId, context);
        const updated = ProjectManager.updateCurrentStep(input.projectId, input.taskId, input.stepIndex);
        context.actions.agentHandler.onStreamText({
            browserId: context.browserId,
            text: JSON.stringify(updated),
            tag: 'update_task_current_step'
        });

        ProjectManager.fireProjectInfoEvent(input.projectId, context);
        return JSON.stringify(updated);
    },
};

type GetProjectListInput = {
    includingClosed: boolean;
};

export const getProjectListTool: ToolDesc<GetProjectListInput> = {
    tool: {
        name: 'get_project_list',
        description: `Get the list of projects. If includingClosed is true,
closed projects will also be included.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                includingClosed: {type: 'boolean', description: 'Whether to include closed projects.'},
            },
            required: ['includingClosed'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: true,
    invoke: async function(input: GetProjectListInput): Promise<string> {
        return JSON.stringify(ProjectManager.getProjectList(input.includingClosed));
    },
}

type GetProjectDetailInput = {
    projectId: string;
};

export const getProjectDetailTool: ToolDesc<GetProjectDetailInput> = {
    tool: {
        name: 'get_project_detail',
        description: 'Get the detailed information of a project with its project id.',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                projectId: {type: 'string', description: 'The ID of the project.'},
            },
            required: ['projectId'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: true,
    // A review is told which task it reads and nothing else of the board it sits on: the task
    // before it, what blocks it, what the project is for. All of that is read here.
    loopKinds: [...DEFAULT_LOOP_KINDS, 'review'],
    invoke: async function(input: GetProjectDetailInput): Promise<string> {
        return JSON.stringify(ProjectManager.getProjectDetail(input.projectId));
    },
}
