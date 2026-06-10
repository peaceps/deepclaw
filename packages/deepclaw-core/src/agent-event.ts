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
    options: (string | {label: string; value: string | boolean | number})[];
});

// TODO: Implement this
export type AgentInfoEvent = {

};