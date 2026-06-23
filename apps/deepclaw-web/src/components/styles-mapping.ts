import type { Message } from "@/component-types";
import type { Project, MissionStatus, AgentEmployee} from "@deepclaw/core";
import { getProjectStatus } from "./component-utils";

export const avatarBG = 'bg-gradient-to-br from-amber-400 to-cyan-500';

export function getProjectStatusStyles(project: Project): string {
    return projectStatusStyles[getProjectStatus(project)];
}

export const projectStatusStyles: Record<MissionStatus, string> = {
    todo: 'bg-gray-100 text-gray-700',
    ongoing: 'bg-green-100 text-green-700',
    done: 'bg-blue-100 text-blue-700'
};

export const moodEmojis: Record<AgentEmployee['mood'], string> = {
    happy: '😊',
    focused: '🎯',
    tired: '😴',
    confused: '🤔',
    none: '🙃',
};

export const statusColors: Record<AgentEmployee['status'], string> = {
    busy: 'bg-red-500',
    idle: 'bg-green-500',
    fired: 'bg-gray-400',
};

export const priorityStyles: Record<Project['priority'], string> = {
    urgent: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-blue-100 text-blue-700',
    low: 'bg-gray-100 text-gray-700',
};

export const messageFlexStyles: Record<Message['type'], string> = {
    user: 'justify-end',
    agent: 'justify-start',
};

export const messageTextStyles: Record<Message['type'], string> = {
    user: 'bg-blue-500 text-white',
    agent: 'bg-gray-100 text-gray-800',
};

export const messageTimeStyles: Record<Message['type'], string> = {
    user: 'text-blue-200',
    agent: 'text-gray-400',
};
