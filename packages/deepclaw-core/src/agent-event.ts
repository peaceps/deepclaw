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

// TODO: Implement this
export type AgentInfoEvent = {

};