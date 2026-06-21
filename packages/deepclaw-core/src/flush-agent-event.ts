import { AgentEmployee } from "./agent-definitions";
import { Project } from "./project-definitions";

export type AgentStreamEvent = {
    chatKey: string;
    text: string;
    done?: boolean;
};

export type AgentToolResultEvent = {
    chatKey: string;
    toolName: string;
    data: any;
};

export type AgentInteractionEventOption = string | {label: string; value: string | boolean | number};

export type AgentInteractionEvent = {
    content: string;
    i18nParam?: Record<string, string | number>;
    key?: string;
} & ({
    type: 'readonly';
} | {
    type: 'input';
} | {
    type: 'select';
    options: AgentInteractionEventOption[];
});

export type AgentInfoEvent = {
    type: 'updateProject',
    content: Project
} | {
    type: 'updateAgent',
    content: Partial<AgentEmployee> & {id: string}
};
