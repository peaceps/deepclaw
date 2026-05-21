export const en = {
    agent: {
        maxTurnReached: 'Reached maximum turn count. Ending session.\n{{finalText}}',
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
                request: 'Request access permission. Allow(y/n)?',
            },
            file: {
                guard: 'Deepclaw is going to access files outside current work dir.',
                write: 'Wrote {{length}} bytes to {{path}}.',
                edit: 'Edit {{path}} successfully.',
            },
            shell: {
                guard: {
                    danger: 'Dangerous command({{command}}) blocked.',
                    warn: 'Need permission to run command({{command}}).',
                    mode: 'Deepclaw is not running on agent mode, permission needed to run command({{command}}).',
                },
                empty: '(no output)',
                error: 'Error: {{message}}.',
                timeout: 'Error: Timeout ({{timeout}}s).',
            },
            todo: {
                empty: 'No steps.',
                current: '\nCurrent step:\n{{steps}}\n',
                completed: '({{completed}}/{{total}} completed)',
            },
        },
    },
};
