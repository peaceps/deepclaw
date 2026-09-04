import type { MissionPriority } from '@deepclaw/core';

export const en = {
    server: {
        meta: {
            title: 'DeepClaw - Your agent is working',
            description: 'See what your agents are doing',
        },
    },
    web: {
        common: {
            iam: 'I\'m {{name}}, good at {{expertises}} areas, ready to serve you!',
            all: 'All',
            toggle: {
                expand: 'Expand',
                collapse: 'Collapse',
            },
            // Held to the priorities there are: a word without a label here is drawn on the board
            // as the key it was looked up by, which nothing else would report.
            priority: {
                urgent: 'Urgent',
                high: 'High',
                medium: 'Medium',
                low: 'Low',
            } satisfies Record<MissionPriority, string>,
            notReady: 'Coming soon...',
            edit: 'Edit',
            add: 'Add',
            save: 'Save',
            cancel: 'Cancel',
            confirm: 'Confirm',
            send: 'Send',
            ok: 'OK',
            maximize: 'Maximize',
            restore: 'Restore',
            copy: 'Copy the markdown',
            copied: 'Copied',
            copyFailed: 'Nothing was copied. Select the text and copy it by hand.',
        },
        toast: {
            interactionPause: {
                role: {
                    agent: 'Agent',
                    project: 'Project'
                },
                title: 'Interaction request',
                message: '{{role}} ({{name}}) has an interaction request.'
            },
            runEnded: {
                role: {
                    agent: 'Agent',
                    project: 'Project'
                },
                title: 'Answer waiting',
                message: '{{role}} ({{name}}) finished its work.'
            },
            imConnected: {
                title: 'IM connected',
                message: 'IM of {{data}} connected successfully.'
            },
            imConnectFailed: {
                title: 'IM connection failed',
                message: 'IM of {{data}} connection failed.'
            }
        },
        sidebar: {
            subtitle: 'You are not alone',
            links: {
                agents: 'Agents',
                projects: 'Project Board',
                cron: 'Scheduled Tasks',
                skills: 'Skills',
                settings: 'Settings',
            },
            manager: {
                changeAvatar: 'Change avatar',
            },
        },
        pages: {
            agents: {
                noSelection: {
                    title: 'Please select an Agent to view details',
                    description: 'Select an Agent from the left list to view its role setting, personality traits and work status',
                },
                mood: {
                    happy: 'Happy',
                    focused: 'Focused',
                    tired: 'Tired',
                    confused: 'Confused',
                    none: 'Secret',
                },
                list: {
                    title: 'Agent list'
                },
                card: {
                    finishedTasks: 'Finished {{count}} tasks'
                },
                status: {
                    busy: 'Busy',
                    idle: 'Idle',
                    fired: 'Graduated',
                },
                actions: {
                    praise: 'Praise',
                    criticize: 'Criticize',
                    more: 'More actions',
                },
                details: {
                    header: {
                        projectsCompleted: 'Projects Completed',
                        doneArchived: '{{count}} put away',
                        changeAvatar: 'Change avatar',
                        editRole: 'Edit role',
                        emotions: 'Emotions',
                        noEmotions: 'No emotions yet',
                    },
                    labels: {
                        save: 'Press Enter to save',
                    },
                    personality: {
                        title: 'Personality',
                        emotionExpression: 'Emotion Expression',
                    },
                    expertises: {
                        title: 'Expertises',
                    },
                    description: {
                        title: 'Description',
                        noContent: 'Who am I?',
                    },
                    currentProject: {
                        title: 'Current Project',
                        noProject: 'No project ongoing',
                    },
                    runningTasks: {
                        title: 'Running Now',
                        noTask: 'No task running',
                        startedAt: 'Started {{time}}',
                        reading: 'Reading over',
                    },
                    crons: {
                        title: 'Scheduled Tasks',
                        noTask: 'No scheduled task',
                    },
                },
                mobile: {
                    returnToList: 'Return to list',
                    returnToDetail: 'Return to detail',
                }
            },
            projects: {
                title: 'Task Board',
                projectList: 'Project list',
                ownerFilter: 'Owner',
                search: {
                    placeholder: 'Search project title, description, or tags...',
                    noResults: 'No matching projects',
                    clear: 'Clear search',
                },
                status: {
                    todo: 'Todo',
                    ongoing: 'Ongoing',
                    done: 'Done',
                },
                archived: {
                    action: 'Archived',
                    hint: 'Look back through the projects you have put away',
                    title: 'Projects you have put away',
                    empty: 'Nothing has been put away yet',
                    noResults: 'No matching projects in the archive',
                    failed: 'The archive could not be read. Close this and open it again.',
                    putAwayOn: 'Put away {{date}}',
                    writtenOn: 'Written {{date}}',
                    more: 'Read more',
                    restore: {
                        action: 'Put back',
                        hint: 'Put this project back on the board',
                        failed: 'The project could not be put back. Try again.',
                    },
                    delete: {
                        action: 'Delete',
                        hint: 'Delete project completely',
                        confirm: 'Delete for good? Tasks, chat and reports go with it.',
                        failed: 'The project could not be deleted. Try again.',
                    },
                },
                project: {
                    noTasks: 'No tasks in this project',
                    noTasksAtStatus: 'No tasks',
                    owner: 'Owner',
                    progress: 'Progress',
                    report: 'Project report',
                    editDescription: 'Rewrite what this project is about',
                    workingDir: {
                        label: 'Edit working dir',
                        unset: 'Use deepclaw\'s data directory',
                        placeholder: 'A folder the work happens in, e.g. C:/Users/foo/bar, press Enter to confirm. Cannot be changed after the project started.',
                        edit: 'Say which folder the work of this project happens in. Commands start there, and the files it writes go there.',
                        settled: 'The folder this project works in. Settled before the work started.',
                        clear: 'Work beside the deepclaw data again',
                        failed: 'The working dir could not be saved',
                        make: {
                            action: 'Make the folder',
                            confirm: 'There is nothing at "{{path}}". Make the folder and have this project work in it? Check the path first.',
                        },
                    },
                    blockedBy: 'Prerequisites: {{titles}}',
                    labels: {
                        save: 'Press Enter to save',
                    },
                    tasksUnread: 'The tasks of this project could not be read. Close the row and open it again.',
                    start: {
                        action: 'Start work',
                        hint: 'Let the agent hand the tasks of this plan out',
                        running: 'This project is in the middle of a run, wait for it to finish',
                        confirm: 'Start "{{title}}"? The agent begins handing the tasks above out to subagents, and there is no calling that back.',
                        kickoff: 'Start the work on this project: hand out the tasks that are ready.',
                        busy: 'The work is on, but the agent was in the middle of a run and did not hear it. Tell it in its chat once that run is done.',
                        error: 'The work is on, but the agent could not be reached. Tell it in its chat.',
                        failed: 'The work could not be started. Nothing was changed, and it is worth trying again.',
                    },
                    archive: {
                        action: 'Archive',
                        hint: 'Take this project off the board, keeping it on disk',
                        running: 'Someone is working on this project right now',
                        confirm: 'Archive "{{title}}"? It leaves the board and the list the agents read, and stays on disk.',
                    },
                },
                task: {
                    pause: {
                        title: {
                            on: 'Pause after this task done.',
                            off: 'Will not pause after this task done.',
                            locked: 'Paused and waiting for your verification, cannot be lifted now.',
                        }
                    },
                    verified: {
                        title: {
                            on: 'Verified',
                            off: 'Not verified',
                        }
                    },
                    status: {
                        menu: 'Move this task on',
                        locked: 'This task is being worked on right now, so where it stands is not yours to move.',
                        ongoing: 'Mark it ongoing',
                        ongoingHint: 'The task becomes ongoing: no handing it on after that, and no way back to todo.',
                        ongoingHintUnstarted: 'The project starts here and the task becomes ongoing: no handing it on after that, and no way back to todo.',
                        done: 'Mark it done',
                        doneHint: 'Every step of it is marked behind it.',
                        doneHintPaused: 'Every step of it is marked behind it, and closing it yourself counts as the verification its pause was waiting for.',
                    },
                    running: 'This task is being worked on right now',
                    editTitle: 'Rename this task',
                    editDescription: 'Rewrite what this task asks for',
                    editAssignee: 'Hand this task to another agent',
                    editPriority: 'Change how soon this task is to be picked up',
                    review: {
                        add: 'Reviewer',
                        addHint: 'Have another agent read this task over before it closes',
                        edit: 'Change who reads this task over',
                        none: 'Unset',
                        role: 'Reviewer',
                        running: 'This task is being read over right now',
                        waived: 'Not reviewed, you closed it',
                        report: 'Review report',
                        reportShort: 'Report',
                    },
                }
            },
            chat: {
                invalidTarget: 'Invalid target',
                type: {
                    project: {
                        title: 'Project chat',
                        emptyPrompt: 'Talk everything about this project...',
                    },
                    agent: {
                        title: 'Agent chat',
                        emptyPrompt: 'Chat with {{name}}',
                    },
                },
                invoke: {
                    error: 'LLM has an unexpected error.'
                },
                send: 'Send message to {{name}}...',
                stop: {
                    title: 'Stop',
                    stopping: 'Stopping...',
                    error: 'Could not stop the run.',
                    ended: 'This run had already ended.',
                },
                loading: 'Thinking...',
                emptyLLMOutput: 'LLM kept silent...',
                image: {
                    upload: 'Upload image',
                    tooLarge: '{{name}} is over {{size}}MB and was skipped.',
                    tooMany: 'A message carries at most {{count}} images.',
                },
                noAgent: {
                    title: '😔 Sorry',
                    description: 'This Agent seems to be lost...',
                },
                session: {
                    new: 'New conversation',
                    newConfirm: 'Close this conversation and start {{name}} from an empty context?'
                        + ' You can still read it back afterwards.',
                    newConfirmAction: 'Start new',
                    busyHint: 'Still working, wait for the answer first.',
                    history: 'Past conversations',
                    loading: 'Loading...',
                    empty: 'No conversation was closed yet.',
                    emptyRead: 'Nothing was said in this conversation.',
                    noSummary: 'Ended without a word.',
                    meta: '{{date}} · {{turns}} turns · {{tokens}} tokens',
                    readonly: 'Reading a conversation that was closed.',
                    backToCurrent: 'Back',
                    refused: {
                        busy: 'The agent is working. Wait for the answer, then start over.',
                        backgroundCommand: 'A background command is still running.'
                            + ' Wait for it to finish, then start over.',
                        unsupported: 'This chat cannot start a new conversation.',
                        archiveFailed: 'The conversation could not be filed away, so it was left'
                            + ' open. Nothing was changed, and it is worth trying again.',
                    },
                    error: 'Starting a new conversation failed.',
                },
            },
            tokenUsage: {
                cachedInput: 'Cached input',
                noCachedInput: 'No cached input',
                cacheHitRate: 'Input cache hit rate',
                output: 'Output'
            },
            output: {
                title: 'Task report',
                download: 'Download report',
                view: 'View report',
                fetchFailed: 'File fetch failed.',
                saveFailed: 'The report was not saved. What you wrote is still in the box.',
                busy: 'The task is being worked on right now, and the run will write its own report'
                    + ' over this one. Save it once the work is back.',
            },
            skills: {
                columns: {
                    name: 'Name',
                    description: 'Description',
                    agent: 'Applied to',
                    remove: 'Remove',
                },
                empty: 'No skills available',
                resetToAll: 'All agents',
                remove: 'Remove this skill',
                confirmRemove: '{{name}} goes off the disk with every file in its folder.',
                removeMissing: '{{name}} is no longer installed, the list is up to date now.',
                removeFailed: 'Failed to remove {{name}}.',
                installHint: 'Tip: you can install new skills by chatting with an agent — just ask it to find and install a skill for you.',
            },
            cron: {
                tip: 'Tip: you can create scheduled tasks by chatting with an agent - just tell it what to run and when.',
                empty: 'No scheduled tasks',
                status: {
                    running: 'Scheduled',
                    paused: 'Paused',
                },
                creator: 'Creator',
                lastRun: 'Last run',
                nextRun: 'Next run',
                schedule: 'Schedule',
                prompt: 'Prompt',
                actions: {
                    pause: 'Pause',
                    resume: 'Resume',
                    delete: 'Delete',
                    confirmDelete: '{{name}} is deleted for good, with everything it has run so far.',
                },
                history: {
                    title: 'Execution History',
                    empty: 'No executions yet',
                },
                edit: {
                    title: 'Edit task title',
                    schedule: 'Edit schedule',
                    prompt: 'Edit prompt',
                    invalidCron: 'This expression does not name a time the server can schedule by.',
                    failed: 'The change did not go through.',
                },
            },
            settings: {
                title: 'System Settings',
                description: 'Configure the settings for the application',
                saveButton: 'Save',
                saved: 'Settings saved',
                saveFailed: 'Settings saving failed',
                langSaved: 'Language saved',
                langSaveFailed: 'Language saving failed',
                errors: {
                    total: 'error(s) found, please fix before saving',
                    ui: 'UI Settings: {{count}} error(s)',
                    agents: 'Agent Settings: {{agentCount}} agents with {{errorCount}} error(s)'
                },
                panels: {
                    ui: {
                        title: 'UI Settings',
                        description: 'Language and other UI settings'
                    },
                    agents: {
                        title: 'Agent Settings',
                        description: 'Configure agents',
                        addButton: 'Hire new agent',
                        removeButtonTitle: 'Fire this agent',
                        removeButton: 'Fire',
                        header: {
                            unnamed: 'Unnamed',
                            errors: 'error(s)'
                        },
                        sections: {
                            basic: 'Basic info',
                            im: 'Connect IM software',
                            llm: 'LLM configs',
                            image: 'Multimodal configs',
                        },
                        imageModel: {
                            placeholder: '<Please select an image model>',
                        },
                        protocol: {
                            auto: 'Auto-detect',
                        }
                    },
                    advanced: {
                        title: 'Advanced Settings',
                        description: 'Advanced settings for the application',
                        mcpServer: {
                            placeholder: 'http://localhost:6059/mcp',
                        },
                    }
                }
            },
        },
        config: {
            error: {
                input: 'Field {{name}} cannot be empty',
                select: 'Please choose value for {{name}}'
            },
            manager: {
                name: {
                    prompt: 'Manager nickname'
                },
                title: {
                    prompt: 'Manager title'
                }
            },
            ui: {
                lang: {
                    prompt: 'Language / 语言',
                    options: {
                        en: 'English',
                        zh: '简体中文',
                    },
                },
            },
            agents: {
                error: 'At least one Agent is required',
                name: {
                    prompt: 'Nickname',
                },
                mode: {
                    prompt: 'Running mode',
                    options: {
                        agent: 'Agent (OS operable)',
                        chat: 'Chat (Chat only, no OS operation)',
                    },
                },
                im: {
                    engine: {
                        prompt: 'IM tool',
                        options: {
                            dingtalk: 'DingTalk',
                            feishu: 'Feishu',
                        },
                    },
                    appId: {
                        prompt: 'App ID',
                    },
                    secret: {
                        prompt: 'Secret',
                    }
                },
                llm: {
                    baseURL: {
                        prompt: 'Base URL',
                    },
                    apiKey: {
                        prompt: 'API key',
                    },
                    model: {
                        prompt: 'LLM model',
                    },
                    protocol: {
                        prompt: 'LLM protocol',
                        options: {
                            Anthropic: 'Anthropic',
                            OpenAIChat: 'OpenAIChat',
                            OpenAIResponse: 'OpenAIResponse',
                        },
                    },
                },
                multimodal: {
                    imageModel: {
                        prompt: 'Image model',
                        options: {
                            'doubao-seedream-5-0-pro-260628': 'Seedream 5.0 Pro',
                            'doubao-seedream-5-0-260128': 'Seedream 5.0 Lite',
                            'doubao-seedream-4-5-251128': 'Seedream 4.5',
                            'doubao-seedream-4-0-250828': 'Seedream 4.0',
                            'qwen-image-3.0': 'Qwen Image 3',
                            'qwen-image-2.0-pro-2026-06-22': 'Qwen Image 2.0 Pro 2026-06-22',
                            'gpt-image-2': 'GPT Image 2',
                        },
                    },
                    imageApiKey: {
                        prompt: 'API key for image generation',
                    },
                }
            },
            advanced: {
                mcpServer: {
                    prompt: 'MCP server address',
                },
            }
        },
    },
};
