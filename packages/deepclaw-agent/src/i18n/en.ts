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
        maxTurnReached: 'Reached maximum turn count. Ending session.',
        contextTooLong: 'This conversation is too long for the current model, and summarizing it did not bring it under the limit. Start a new conversation, or switch to a model with a larger context window.',
        agentBreak: {
            agentStop: {
                projectCreated: {
                    llm: 'Project is created. The plan is adjusted in the conversation of the project itself.',
                    user: 'Project is created. Open its row on the board to go over the plan and start it.',
                },
            },
            externalInterrupt: {
                clientLost: {
                    llm: 'Client lost connection. Ending session.',
                    user: 'Client lost connection. Ending session.',
                },
                userStopped: {
                    llm: 'The user stopped this run.',
                    user: 'Stopped.',
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
                // The reason is prepended verbatim, so the separator has to live here, where
                // each language decides its own: english needs the leading space, chinese
                // follows a full stop and reads worse with one. Keep the space.
                request: ' Request access permission.',
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
            // Asked by both command tools, the foreground one and the background one.
            command: {
                guard: {
                    danger: 'Dangerous command({{command}}) blocked.',
                    warn: 'Need permission to run command({{command}}).',
                    mode: 'Deepclaw is not running on agent mode, permission needed to run command({{command}}).',
                },
            },
            syncCommand: {
                empty: '(no output)',
                error: 'Error: {{message}}.',
                timeout: 'Error: Timeout ({{timeout}}s).',
                stopped: 'The command was stopped by the user before it finished.',
            },
            image: {
                noKey: `No API key for image generation. Set it in the image settings of this agent,
or in the {{env}} environment variable.`,
                noModel: 'No image model picked yet. Pick one in the image settings of this agent.',
                unsupportedModel: `Images cannot be generated with {{model}} yet. Pick one of the
qwen-image, seedream or gpt-image models in the image settings of this agent.`,
                saved: `Image generated. Put ![image]({{url}}) in the answer, that reference is what
carries the picture into a chat.`,
                kept: `Picture kept. Put ![image]({{url}}) in the answer, that reference is what
carries it into a chat, where the path it was written to shows the user nothing.`,
                notAPicture: '{{path}} is no picture, going by its name. Only png, jpg, gif and webp are kept.',
                tooLargeToKeep: `{{path}} is {{size}}MB, more than the {{limit}}MB a picture may be
kept at. Write a smaller one, a screenshot of one part of the page rather than the whole of it.`,
                unknownImage: `No picture is known as {{ref}}. Only a dcimg:// reference of this
conversation or a link can be drawn from.`,
                imageTooLarge: `{{ref}} is {{size}}MB, more than the {{limit}}MB an image model
takes. Draw from a smaller picture.`,
            },
            subLoop: {
                drawnImages: `The subagent drew these pictures. Naming one in your own answer is
what carries it into the chat, nothing the subagent did puts it there:
{{images}}`,
                changes: `The subagent did not finish. What it changed before it stopped, in the
order the changes reached it -- a step marked (subagent) is one of its own subagents, handed over
whole when that one came back:
{{steps}}
Its session is gone and there is nobody left to ask about any of it. A command left in the
background is the exception: it outlived the subagent and is filed under this run, so
check_all_background_command_status lists it for you and it may well still be writing. Whatever of
the work is worth having is yours to look at on disk and to finish or hand out again.`,
                changesCut: '({{count}} earlier changes left out)',
            },
            project: {
                // Handed to the run on the result of the call that was held, for it to pass on. The
                // words are the user's language and not the model's, so they can go through as they
                // are: what the user reads about their own pause is the same sentence either way.
                awaitVerify: `Task {{name}} has been done, please verify the output.
You can ask me continue to modify the output or mark the task as verified when you feel ok.`,
                taskSteps: {
                    empty: 'No steps.',
                    current: '\nCurrent step:\n{{steps}}\n',
                    completed: '({{completed}}/{{total}} completed)'
                },
                output: {
                    generatedFiles: 'Generated files',
                    // Added to the report of a task that worked in a checkout of its own. Nothing
                    // of that work is in the folder the user named, so a report without this line
                    // leaves them to go looking for what a task did. Nothing is ever cleared away
                    // for them either: what a checkout holds is work, and work is not ours to
                    // decide is finished with, so the line says whose the leftovers are.
                    worktree: 'This task worked on branch {{branch}}, in a checkout of its own at '
                        + '{{dir}}. Nothing of it has been merged, and both stay as they are until '
                        + 'you merge that branch or clear that folder away yourself.',
                },
            },
        },
    },
};
