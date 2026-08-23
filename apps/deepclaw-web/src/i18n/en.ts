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
            priority: {
                urgent: 'Urgent',
                high: 'High',
                medium: 'Medium',
                low: 'Low',
            },
            notReady: 'Coming soon...',
            edit: 'Edit',
            add: 'Add',
            cancel: 'Cancel',
            confirm: 'Confirm',
            send: 'Send',
            ok: 'OK',
            maximize: 'Maximize',
            restore: 'Restore',
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
                project: {
                    noTasks: 'No tasks in this project',
                    noTasksAtStatus: 'No tasks',
                    owner: 'Owner',
                    progress: 'Progress',
                    blockedBy: 'Prerequisites: {{titles}}',
                    labels: {
                        save: 'Press Enter to save',
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
                    running: 'A subagent is working on this task',
                    editTitle: 'Rename this task',
                    editDescription: 'Rewrite what this task asks for',
                    editAssignee: 'Hand this task to another agent',
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
