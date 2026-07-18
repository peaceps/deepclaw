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
        },
        toast: {
            interactionPause: {
                role: {
                    agent: 'Agent',
                    project: 'Project'
                },
                title: 'Interaction request',
                message: '{{role}} ({{name}}) has an interaction request.'
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
                    workStatus: {
                        title: 'Working Status',
                        currentProject: 'Current Project',
                        noProject: 'No project ongoing',
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
                            off: 'Will not pause after this task done.'
                        }
                    },
                    output: {
                        title: 'Task report',
                        download: 'Download task report',
                        view: 'View task report',
                    }
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
                noAgent: {
                    title: '😔 Sorry',
                    description: 'This Agent seems to be lost...',
                },
                tokenUsage: {
                    cachedInput: 'Cached input',
                    noCachedInput: 'No cached input',
                    output: 'Output'
                }
            },
            settings: {
                title: 'System Settings',
                description: 'Configure the settings for the application',
                saveButton: 'Save',
                saved: 'Settings saved',
                saveFailed: 'Settings saving failed',
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
                            im: 'IM configs',
                            llm: 'LLM configs',
                        }
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
                    }
                }
            },
        },
    },
};
