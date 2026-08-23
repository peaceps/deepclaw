import { ToolDesc } from "../../definitions/tool-definitions";
import { ProjectManager } from "../services/project-manager";
import { type LLMTaskOutput, type MissionPriority, type MissionStatus, PROJECT_CONFIG, type Task } from "@deepclaw/core";
import { OneLoopContext } from '../../definitions/definitions';
import { i18nInstance } from "@deepclaw/i18n";
import { UpdateContent } from "@deepclaw/utils";
import { AgentIdentityManager } from "../services/agent-identity-manager";
import { keptOutput, MAX_GENERATED_FILES, publishGeneratedFiles, requireReadableOutput, skippedFilesNote } from "../../loop-utils";
import { projectFilesDir } from "../../paths";

/** Where the report of a task stood in an answer that is not the one to ask for it. */
const OUTPUT_KEPT = '<Output kept, read it with get_project_detail>';

/** The project as an answer to a write of it, with what its tasks produced left out. */
function projectAfterWrite(projectId: string): string {
    const project = ProjectManager.getProjectDetail(projectId);
    const tasks: Record<string, Task> = {};
    for (const [id, task] of Object.entries(project.tasks)) {
        tasks[id] = task.output ? {...task, output: keptOutput(task.output, OUTPUT_KEPT)} : task;
    }
    return JSON.stringify({...project, tasks});
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
            enum: ['low', 'medium', 'high', 'urgent'],
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
 * The same task on its way back through update_project, where the id has to be free of the shape
 * asked of a new one. A project made before ids were handed out wears the old task title as its
 * id, and a handle demanded here would leave the model no way to bring such a task back as it is.
 */
const keptTaskItemSchema = {
    ...taskItemSchema,
    properties: {...taskItemSchema.properties, id: taskIdSchema},
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
                    maxLength: 100,
                },
                priority: {
                    type: 'string',
                    enum: ['low', 'medium', 'high', 'urgent'],
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
${projectAfterWrite(project.id)}`;
    },
}

type CreateSimpleTaskInput = {
    id: string;
    title: string;
    description: string;
    priority: MissionPriority;
    steps?: string[];
};

export const createSimpleTaskTool: ToolDesc<CreateSimpleTaskInput> = {
    tool: {
        name: 'create_simple_task',
        description: `Create a single task without dependencies. It will be wrapped into a project that contains only this task.
they will be persisted in file system. After task created, user can review the plan and ask to make changes to the plan, 
so do not call tools updating project/tasks immediately with create_simple_task`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                id: {
                    type: 'string',
                    description: `How every tool reaches this task from now on. Give it a short
lowercase handle of what the task is about, "design" or "api-schema". The user never sees it and it
never changes, unlike the title beside it.`,
                    pattern: TASK_ID_PATTERN,
                    minLength: 1,
                    maxLength: 30,
                },
                title: {
                    type: 'string',
                    description: `The title of the task, will display to the user.`,
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
                    enum: ['low', 'medium', 'high', 'urgent'],
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
            },
            required: ['id', 'title', 'description', 'priority'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: false,
    loopKinds: ['main'],
    invoke: async function(input: CreateSimpleTaskInput, context: OneLoopContext): Promise<string> {
        const task: Task = ProjectManager.createTask(
            {...input, agentId: context.agentId}
        );
        const project = ProjectManager.createProject({
            agentId: context.agentId,
            title: task.title,
            description: task.description,
            priority: task.priority,
        }, [task]);
        ProjectManager.fireProjectInfoEvent(project.id, context);
        context.runtime.agentBreakReason = 'projectCreated';
        return `Task created successfully.
Here's the wrapper project info:
${projectAfterWrite(project.id)}`;
    }
};

type UpdateProjectInput = {
    projectId: string;
    title?: string;
    description?: string;
    priority?: MissionPriority;
    tasks?: ProjectTaskInput[];
};

export const updateProjectTool: ToolDesc<UpdateProjectInput> = {
    tool: {
        name: 'update_project',
        description: 'Update project info, tasks can only be updated when a project is in todo state.',
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
                    maxLength: 100,
                },
                priority: {
                    type: 'string',
                    enum: ['low', 'medium', 'high', 'urgent'],
                    description: 'The priority of the project.'
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
        const {projectId, tasks, ...patch} =  input;
        const projectTasks = tasks && buildTasks(tasks, context);
        ProjectManager.updateProject({
            id: projectId,
            ...patch,
        }, projectTasks);
        ProjectManager.fireProjectInfoEvent(projectId, context);
        return `Project updated successfully.
Here's the project info:
${projectAfterWrite(projectId)}`;
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
'done' is the status when the task is completed. You can only update the status to the next status.`,
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
                    description: `The output of the task. Whatever the user can just read -- a report, a
summary, a plan, a table -- belongs in the content itself: write it out here instead of saving it to a
file and handing over the path, a file the user has to go and open is worse than the thing itself.
Large content is filed away for you, so there is no size to work around.
Files the task really produced -- a spreadsheet, a picture, a document -- are named in
generatedFiles, and they come back to the user as links to download.
Name a path only for what neither a readable document nor a file can carry: for coding task you can
give the source dir of the task, also you can start the dev server and provide the access address
if possible.`,
                    properties: {
                        type: {
                            type: 'string', enum: ['markdown', 'text'],
                            description: 'Type of the task output.'
                        },
                        content: {
                            type: 'string',
                            description: `Content of the task output, what the user reads of it.
A file the task produced never goes in here as its bytes: hand it over in generatedFiles instead.`
                        },
                        ext: {
                            type: 'string',
                            description: `The extension of the file a large content is filed into,
"md" for markdown and "txt" for text unless the content is really something else, e.g. "csv".`
                        },
                        generatedFiles: {
                            type: 'array',
                            items: {type: 'string'},
                            maxItems: MAX_GENERATED_FILES,
                            description: `The files this task produced, by their path in the workspace.
Each one is linked at the end of the content, so hand a file over here rather than writing its path
into the content: a path in a report is nothing the user can open. One written into the files folder
of the project is handed over as it lies, one from anywhere else is copied in there first.
A picture handed over this way is shown in the output rather than linked under it.
Only files inside the workspace can be handed over, and only files, not folders.`
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

        let res = `Task updated successfully.
Here's the related info:
${projectAfterWrite(input.projectId)}`;
        if (stop) {
            res += `

Task is not set done because the user requires it to be verified before it can be marked done.
After user set task.verified to true, it can be successfully set done.`;
        }
        return res + skippedFilesNote(skippedFiles);
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
        description: `Get the list of projects including simple task wrapper projects. If includingClosed is true,
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
