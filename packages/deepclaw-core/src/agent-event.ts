export type AgentInteractionEvent = {
    content: string;
    key?: string;
} & ({
    type: 'readonly';
} | {
    type: 'input';
} | {
    type: 'select';
    options: (string | {label: string; value: string})[];
});

// TODO: Implement this
export type AgentInfoEvent = {

};