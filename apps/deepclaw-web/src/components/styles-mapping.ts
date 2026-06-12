import { AgentEmployee, Message, Project, Task } from "@/types";

export const moodEmojis: Record<AgentEmployee['mood'], string> = {
    happy: '😊',
    focused: '🎯',
    tired: '😴',
    confused: '🤔',
};

export const statusColors: Record<AgentEmployee['status'], string> = {
    busy: 'bg-red-500',
    idle: 'bg-green-500',
    offline: 'bg-gray-400',
};

export const statusTexts: Record<AgentEmployee['status'], string> = {
    busy: 'pages.agents.status.busy',
    idle: 'pages.agents.status.idle',
    offline: 'pages.agents.status.offline',
};

export const priorityTexts: Record<Project<Task>['priority'], string> = {
    urgent: 'common.priority.urgent',
    high: 'common.priority.high',
    medium: 'common.priority.medium',
    low: 'common.priority.low',
};

export const priorityStyles: Record<Project<Task>['priority'], string> = {
    urgent: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-blue-100 text-blue-700',
    low: 'bg-gray-100 text-gray-700',
};

export const messageFlexStyles: Record<Message['type'], string> = {
    user: 'justify-end',
    agent: 'justify-start',
    thought: 'justify-start'
};

export const messageTextStyles: Record<Message['type'], string> = {
    user: 'bg-blue-500 text-white',
    agent: 'bg-gray-100 text-gray-800',
    thought: 'bg-purple-50 text-purple-700 border border-purple-200'
};

export const messageTimeStyles: Record<Message['type'], string> = {
    user: 'text-blue-200',
    agent: 'text-gray-400',
    thought: 'text-gray-400'
};
