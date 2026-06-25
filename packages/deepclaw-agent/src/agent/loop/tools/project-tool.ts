import { ToolDesc } from "../../definitions/tool-definitions";
import { ProjectManager } from "../services/project-manager";
import { Project, Task } from "@deepclaw/core";
import { OneLoopContext } from '../../definitions/definitions';

type CreateProjectInput = {
    title: string;
    description: string;
    priority: Project['priority'];
    tasks: {
        title: string;
        description: string;
        priority: Task['priority'];
        steps?: string[];
        blockedBy?: string[];
    }[];
};

export const createProjectTool: ToolDesc<CreateProjectInput> = {
    tool: {
        name: 'create_project',
        description: 'Create a new project with its tasks. project is a long term goal that can be broken down into tasks, they will be persisted in file system.',
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
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            title: {
                                type: 'string',
                                description: 'The title of the task, will display to the user. It should be unique across tasks in this project.',
                                minLength: 1,
                                maxLength: 50,
                            },
                            description: {
                                type: 'string',
                                description: 'A short description of the task, will display to the user.',
                                minLength: 1,
                                maxLength: 100,
                            },
                            priority: {
                                type: 'string',
                                enum: ['low', 'medium', 'high', 'urgent'],
                                description: 'The priority of the task.'
                            },
                            steps: {
                                type: 'array',
                                items: {type: 'string'},
                                description: `The detailed steps to complete the task. Max step count is 8.
You can update the current step index of the task via update_task_current_step tool when task is ongoing to keep track of the progress. 
All steps should be done when task is going to be marked as done.`,
                                maxItems: 8,
                            },
                            blockedBy: {
                                type: 'array',
                                items: {type: 'string'},
                                description: 'The task title of the tasks that this task is blocked by.'
                            },
                        },
                        required: ['title', 'description', 'priority'],
                    },
                    maxItems: 20,
                },
            },
            required: ['title', 'description', 'priority', 'tasks'],
        },
    },
    agentMode: ['agent', 'plan'],
    parallelSafe: false,
    exclusiveInSubLoop: true,
    invoke: async function(input: CreateProjectInput, context: OneLoopContext): Promise<string> {
        const tasks = input.tasks.map(task => ProjectManager.createTask({
            ...task,
            agentId: context.agentId,
        }))
        const project = ProjectManager.createProject({
            agentId: context.agentId,
            title: input.title,
            description: input.description,
            priority: input.priority
        }, tasks);
        
        fireProjectInfoEvent(project.id, context);
        return `Project created successfully.
Here's the project info:
${JSON.stringify(ProjectManager.getProjectDetail(project.id))}`;
    },
}

type CreateSimpleTaskInput = {
    title: string;
    description: string;
    priority: Task['priority'];
    steps?: string[];
};

export const createSimpleTaskTool: ToolDesc<CreateSimpleTaskInput> = {
    tool: {
        name: 'create_simple_task',
        description: `Create a single task without dependencies. It will be wrapped into a project that contains only this task.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                title: {
                    type: 'string',
                    description: `The title of the task, will display to the user.`,
                    minLength: 1,
                    maxLength: 50,
                },
                description: {
                    type: 'string',
                    description: 'A short description of the task, will display to the user.',
                    minLength: 1,
                    maxLength: 100,
                },
                priority: {
                    type: 'string',
                    enum: ['low', 'medium', 'high', 'urgent'],
                    description: 'The priority of the task.'
                },
                steps: {
                    type: 'array',
                    items: {type: 'string'},
                    description: `The detailed steps to complete the task. Max step count is 8.
You can update the current step index of the task via update_task_current_step tool when task is ongoing to keep track of the progress. 
All steps should be done when task is going to be marked as done.`,
                    maxItems: 8,
                },
            },
            required: ['title', 'description', 'priority'],
        },
    },
    agentMode: ['agent', 'plan'],
    parallelSafe: false,
    exclusiveInSubLoop: true,
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
        fireProjectInfoEvent(project.id, context);
        return `Task created successfully.
Here's the wrapper project info:
${JSON.stringify(ProjectManager.getProjectDetail(project.id))}`;
    }
};

type UpdateTaskInput = {
    projectId: string;
    taskTitle: string;
    status: Task['status'];
    steps?: string[];
    assignee?: string;
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
                taskTitle: {type: 'string', description: 'The title of the task.'},
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
                    maxItems: 8,
                },
                assignee: {type: 'string', description: 'The agent name of the task being assigned to.'},
            },
            required: ['projectId', 'taskTitle', 'status'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: false,
    exclusiveInSubLoop: false,
    invoke: async function(input: UpdateTaskInput, context: OneLoopContext): Promise<string> {
        if (input.steps?.length && input.steps?.length > 8) {
            throw new Error('Too much steps for a task. Max is 8.')
        }
        ProjectManager.updateTask(input.projectId, {
            title: input.taskTitle,
            assignee: input.assignee,
            steps: input.steps,
            status: input.status,
        });

        const project = ProjectManager.getProjectDetail(input.projectId);
        fireProjectInfoEvent(input.projectId, context);

        return `Task updated successfully.
Here's the related info:
${JSON.stringify(project)}`;
    },
};

type UpdateTaskCurrentStepInput = {
    projectId: string;
    taskTitle: string;
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
                taskTitle: {type: 'string', description: 'The title of the task.'},
                stepIndex: {
                    type: 'number',
                    description: `The current step index of the ongoing task that is being worked on. 
The stepIndex starts from 0 and should be updated from small to large.
If all steps are done, set stepIndex to the length of steps, and then the task can be marked as done via update_task tool.`
                },
            },
            required: ['projectId', 'taskTitle', 'stepIndex'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: true,
    exclusiveInSubLoop: false,
    invoke: async function(input: UpdateTaskCurrentStepInput, context: OneLoopContext): Promise<string> {
        const updated = ProjectManager.updateCurrentStep(input.projectId, input.taskTitle, input.stepIndex);
        context.actions.agentHandler.onToolText({
            chatKey: context.chatKey,
            toolName: 'update_task_current_step',
            data: updated
        });

        fireProjectInfoEvent(input.projectId, context);
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
    agentMode: ['agent', 'plan'],
    parallelSafe: false,
    exclusiveInSubLoop: false,
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
    agentMode: ['agent', 'plan'],
    parallelSafe: false,
    exclusiveInSubLoop: false,
    invoke: async function(input: GetProjectDetailInput): Promise<string> {
        return JSON.stringify(ProjectManager.getProjectDetail(input.projectId));
    },
}

function fireProjectInfoEvent(projectId: string, context: OneLoopContext) {
    const project = ProjectManager.getProjectDetail(projectId);
    context.actions.agentHandler.onInfoEvent({
        type: 'updateProject',
        content: project
    });
}
