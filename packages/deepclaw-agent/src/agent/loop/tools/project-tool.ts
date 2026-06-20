import crypto from 'crypto';
import { ToolDesc } from "../../definitions/tool-definitions";
import { ProjectManager } from "../services/project-manager";
import { Project, StandaloneTask, Task } from "@deepclaw/core";
import {i18nInstance} from '@deepclaw/i18n';
import { OneLoopContext } from '../../definitions/definitions';

type CreateProjectInput = {
    title: string;
    description: string;
    priority: Project<Task>['priority'];
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
All steps should be done when task is going to be marked as done.`
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
        const projectId = crypto.randomUUID();
        const tasks: Record<string, Task> = input.tasks.reduce((p, n) => {
            if (p[n.title]) {
                throw new Error(`Task title '${n.title}' is not unique across tasks in this project.`);
            }
            p[n.title] = {
                title: n.title,
                description: n.description,
                priority: n.priority,
                status: 'todo',
                creator: context.agentId,
                assignee: context.agentId,
                blockedBy: n.blockedBy || [],
                blocks: [],
                stepsStatus: !n.steps?.length ? undefined : {
                    steps: n.steps,
                    currentStepIndex: -1
                }
            };
            if (n.steps?.length && n.steps?.length > 8) {
                throw new Error('Too much steps for a task. Max is 8.')
            }
            return p;
        }, {} as Record<string, Task>);

        Object.values(tasks).forEach(task => {
            task.blockedBy?.forEach(blockedBy => {
                tasks[blockedBy]?.blocks?.push(task.title);
            });
        });
        
        ProjectManager.createProject({
            id: projectId,
            title: input.title,
            description: input.description,
            priority: input.priority,
            creator: context.agentId,
            tasks,
        });
        return `Project created successfully.
Here's the project info:
${JSON.stringify(ProjectManager.getProjectDetail(projectId))}`;
    },
}

type CreateStandaloneTaskInput = {
    title: string;
    description: string;
    priority: Task['priority'];
    steps?: string[];
};

export const createStandaloneTaskTool: ToolDesc<CreateStandaloneTaskInput> = {
    tool: {
        name: 'create_standalone_task',
        description: `Create a standalone task that is not associated with any project. It will not have any dependency.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                title: {
                    type: 'string',
                    description: `The title of the task, will display to the user. Should be unique across standalone tasks. 
                    Date and datetime can be added to the title if needed to ensure the uniqueness.`,
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
All steps should be done when task is going to be marked as done.`
                },
            },
            required: ['title', 'description', 'priority'],
        },
    },
    agentMode: ['agent', 'plan'],
    parallelSafe: false,
    exclusiveInSubLoop: true,
    invoke: async function(input: CreateStandaloneTaskInput, context: OneLoopContext): Promise<string> {
        const task: StandaloneTask = {
            title: input.title,
            description: input.description,
            priority: input.priority,
            status: 'todo',
            createdAt: new Date().toISOString(),
            creator: context.agentId,
            assignee: context.agentId,
            blockedBy: [],
            blocks: [],
            stepsStatus: !input.steps?.length ? undefined : {
                steps: input.steps,
                currentStepIndex: -1
            }
        };
        if (input.steps?.length && input.steps?.length > 8) {
            throw new Error('Too much steps for a task. Max is 8.')
        }
        let standaloneStrategy = context.loopConfig.standaloneTask;
        if (standaloneStrategy === 'ask') {
            standaloneStrategy = await context.actions.agentHandler.onInteractionEvent({
                type: 'select',
                content: i18nInstance.t('agent.tools.project.standaloneTask.prompt'),
                options: [
                    {label: i18nInstance.t('agent.tools.project.standaloneTask.options.persistent'), value: 'persistent'},
                    {label: i18nInstance.t('agent.tools.project.standaloneTask.options.transient'), value: 'transient'}
                ]
            }) as 'persistent' | 'transient';
        }
        ProjectManager.createStandaloneTask(task, standaloneStrategy === 'persistent');
        return `Standalone task created successfully.
Here's the task info:
${JSON.stringify({
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assignee: task.assignee,
    createdAt: task.createdAt,
})}`;
    }
}

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
        description: 'Update the status of a task in a project. If it\'s a standalone task, projectId should be "standalone".',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                projectId: {type: 'string', description: 'The ID of the project. If it\'s a standalone task, this should be "standalone".'},
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
                        additionalProperties: false,
                        description: `The steps to update, it can be set when a task is in todo status, or when there is no steps in an ongoing task.
They shoudl be short descriptions of each step, should not be too long for user to read.`
                    }
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

        const content = input.projectId === 'standalone' ? ProjectManager.getStandaloneTaskDetail(input.taskTitle) :
            ProjectManager.getProjectDetail(input.projectId);

        fireProjectInfoEvent(input.projectId, input.taskTitle, context);

        return `Task updated successfully.
Here's the related info:
${JSON.stringify(content)}`;
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
                projectId: {type: 'string', description: 'The ID of the project. If it\'s a standalone task, this should be "standalone".'},
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

        fireProjectInfoEvent(input.projectId, input.taskTitle, context);
        return JSON.stringify(updated);
    },
};

type GetProjectListInput = {
    includingClosed: boolean;
};

export const getProjectListTool: ToolDesc<GetProjectListInput> = {
    tool: {
        name: 'get_project_list',
        description: `Get the list of projects and standalone tasks. If includingClosed is true,
closed projects and done standalone tasks will also be included.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                includingClosed: {type: 'boolean', description: 'Whether to include closed projects and done standalone tasks.'},
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

type GetStandaloneTaskDetailInput = {
    title: string;
};

export const getStandaloneTaskDetailTool: ToolDesc<GetStandaloneTaskDetailInput> = {
    tool: {
        name: 'get_standalone_task_detail',
        description: 'Get the detailed information of a standalone task with its title.',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                title: {type: 'string', description: 'The title of the standalone task.'},
            },
            required: ['title'],
        },
    },
    agentMode: ['agent', 'plan'],
    parallelSafe: false,
    exclusiveInSubLoop: false,
    invoke: async function(input: GetStandaloneTaskDetailInput): Promise<string> {
        return JSON.stringify(ProjectManager.getStandaloneTaskDetail(input.title));
    },
}

function fireProjectInfoEvent(projectId: string, taskTitle: string, context: OneLoopContext) {
    const content = projectId === 'standalone' ? ProjectManager.getStandaloneTaskDetail(taskTitle) :
        ProjectManager.getProjectDetail(projectId);
    context.actions.agentHandler.onInfoEvent({
        type: 'updateProject',
        content: 'id' in content ? content : ProjectManager.wrapStandaloneTask(content)
    });
}
