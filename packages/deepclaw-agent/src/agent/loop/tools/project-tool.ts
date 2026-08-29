import { ToolDesc } from "../../definitions/tool-definitions";
import { ProjectManager } from "../services/project-manager";
import {
    type LLMTaskOutput, MISSION_PRIORITIES, type MissionPriority, type MissionStatus,
    PROJECT_CONFIG, type Project, type Task
} from "@deepclaw/core";
import { OneLoopContext } from '../../definitions/definitions';
import { i18nInstance } from "@deepclaw/i18n";
import { UpdateContent } from "@deepclaw/utils";
import { AgentIdentityManager } from "../services/agent-identity-manager";
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
expertises fit it. Leave it out to keep the task yourself. The subagent you hand the task over to
works as its assignee, with the memory and the skills of that agent.`,
        },
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
            description: `The id of the agent that has to work on this task, left out to keep it
yourself.`,
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

function buildTasks(tasks: ProjectTaskInput[], context: OneLoopContext): Task[] {
    return tasks.map(task => {
        requireHiredAssignee(task.assignee);
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
they will be persisted in file system. After project created, user can review the plan and ask to make changes to the plan, 
so do not call tools updating project/tasks immediately with create_project`,
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
    invoke: async function(input: AddTaskInput, context: OneLoopContext): Promise<string> {
        requireHiredAssignee(input.assignee);
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
    invoke: async function(input: UpdateProjectInput, context: OneLoopContext): Promise<string> {
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
in it is under way.`,
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
    invoke: async function(input: UpdateTaskInput, context: OneLoopContext): Promise<string> {
        const taskInfo: UpdateContent<Task> = {id: input.taskId};
        requireHiredAssignee(input.assignee);
        if (input.assignee) taskInfo.assignee = input.assignee;
        if (input.title) taskInfo.title = input.title;
        if (input.description) taskInfo.description = input.description;
        if (input.status) taskInfo.status = input.status;
        let skippedFiles: string[] = [];
        if (input.output) {
            const {generatedFiles, ...output} = input.output;
            requireReadableOutput(output);
            // The links go in before the output is filed away, so the saved report carries them.
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
    invoke: async function(input: UpdateTaskCurrentStepInput, context: OneLoopContext): Promise<string> {
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
    invoke: async function(input: GetProjectDetailInput): Promise<string> {
        return JSON.stringify(ProjectManager.getProjectDetail(input.projectId));
    },
}
