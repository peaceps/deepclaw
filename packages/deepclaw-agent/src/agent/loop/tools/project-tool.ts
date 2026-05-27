import crypto from 'crypto';
import { ToolDesc } from "../../definitions/tool-definitions.js";
import { Project, ProjectManager, Task } from "../services/project-manager.js";

type CreateProjectInput = {
    title: string;
    description: string;
    tasks: {
        title: string;
        description: string;
        priority: Task['priority'];
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
            required: ['title', 'description', 'tasks'],
        },
    },
    agentMode: ['agent', 'plan'],
    parallelSafe: false,
    outputToUser: false,
    exclusiveInSubLoop: true,
    invoke: async function(input: CreateProjectInput): Promise<string> {
        const tasks: Record<string, Task> = input.tasks.reduce((p, n) => {
            if (p[n.title]) {
                throw new Error(`Task title '${n.title}' is not unique across tasks in this project.`);
            }
            p[n.title] = {
                title: n.title,
                description: n.description,
                priority: n.priority,
                status: 'todo',
                creator: 'main',
                assignee: 'main',
                blockedBy: n.blockedBy || [],
                blocks: [],
            };
            return p;
        }, {} as Record<string, Task>);

        Object.values(tasks).forEach(task => {
            task.blockedBy?.forEach(blockedBy => {
                tasks[blockedBy]?.blocks?.push(task.title);
            });
        });
        const project: Project = ProjectManager.createProject({
            id: crypto.randomUUID(),
            title: input.title,
            description: input.description,
            createdAt: new Date().toISOString(),
            creator: 'main',
            tasks,
        });
        return `Project created successfully.
Here's the project info:
${ProjectManager.getProjectInfo(project.id)}`;
    },
}

type UpdateTaskInput = {
    projectId: string;
    taskTitle: string;
    status: Task['status'];
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
                assignee: {type: 'string', description: 'The agent name of the task being assigned to.'},
            },
            required: ['projectId', 'taskTitle', 'status'],
        },
    },
    agentMode: ['agent'],
    parallelSafe: false,
    outputToUser: false,
    exclusiveInSubLoop: true,
    invoke: async function(input: UpdateTaskInput): Promise<string> {
        ProjectManager.updateTask(input.projectId, {
            title: input.taskTitle,
            assignee: input.assignee,
            status: input.status,
        });
        
        return `Task updated successfully.
Here's the project info:
${ProjectManager.getProjectInfo(input.projectId)}`;
    },
};

type GetProjectInfoInput = {
    projectId: string;
};

export const getProjectInfoTool: ToolDesc<GetProjectInfoInput> = {
    tool: {
        name: 'get_project_info',
        description: 'Get the detailed information of a project.',
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
    exclusiveInSubLoop: true,
    outputToUser: false,
    invoke: async function(input: GetProjectInfoInput): Promise<string> {
        return ProjectManager.getProjectInfo(input.projectId);
    },
}
