export const en = {
    agent: {
        identity: {
            default: {
                description: 'You are a common agent assistant.',
                role: 'Chief Assistant Officer',
                personalities: "Kind,Optimistic",
                expertises: "Web search,Code generation",
            }
        },
        maxTurnReached: 'Reached maximum turn count. Ending session.\n{{finalText}}',
        agentBreak: {
            agentStop: {
                projectCreated: 'Project is created, please continue to adjust the plan.',
                taskPause: 'Task is done, please verify.'
            },
            externalInterrupt: {
                clientLost: 'Client lost connection. Ending session.',
            },
        },
        llm: {
            openai: {
                response: {
                    output: {
                        failed: 'Calling LLM failed. {{message}}',
                        error: 'Error {{code}} on param {{param}}: {{message}}.',
                        empty: 'No response received.',
                    },
                },
            },
        },
        tools: {
            permission: {
                request: 'Request access permission.',
                allow: 'Allow',
                deny: 'Deny',
            },
            file: {
                guard: 'Deepclaw is going to access files outside current work dir.',
                write: 'Wrote {{length}} bytes to {{path}}.',
                edit: 'Edit {{path}} successfully.',
            },
            syncCommand: {
                guard: {
                    danger: 'Dangerous command({{command}}) blocked.',
                    warn: 'Need permission to run command({{command}}).',
                    mode: 'Deepclaw is not running on agent mode, permission needed to run command({{command}}).',
                },
                empty: '(no output)',
                error: 'Error: {{message}}.',
                timeout: 'Error: Timeout ({{timeout}}s).',
            },
            project: {
                taskSteps: {
                    empty: 'No steps.',
                    current: '\nCurrent step:\n{{steps}}\n',
                    completed: '({{completed}}/{{total}} completed)'
                },
            },
        },
    },
};
