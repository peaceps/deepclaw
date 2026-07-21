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
                projectCreated: {
                    llm: 'Project is created, waiting for user adjustment.',
                    user: 'Project is created, you can continue to adjust the plan.',
                },
                taskPause: {
                    llm: 'Task is done, waiting for user verification.',
                    user: `Task {{name}} has been done, please verify the output.
You can ask me continue to modify the output or mark the task as verified when you feel ok.`,
                },
            },
            externalInterrupt: {
                clientLost: {
                    llm: 'Client lost connection. Ending session.',
                    user: 'Client lost connection. Ending session.',
                }
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
                allowOnce: 'Allow once',
                always: 'Always allow {{group}} operation in this session',
                deny: 'Deny',
                group: {
                    command: 'command execution',
                    file: 'file',
                }
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
