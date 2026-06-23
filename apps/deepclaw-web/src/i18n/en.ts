export const en = {
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
    },
    sidebar: {
        subtitle: 'One person many agents Company',
        links: {
            agents: 'Agents',
            tasks: 'Task Board',
            chat: 'Message Center',
            org: 'Organization',
            settings: 'Settings',
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
            details: {
                header: {
                    projectsCompleted: 'Projects Completed',
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
                placeholder: 'Search project title or description...',
                noResults: 'No matching projects',
                clear: 'Clear search',
            },
            status: {
                todo: 'Not started',
                ongoing: 'Ongoing',
                done: 'Done',
            },
            project: {
                noTasks: 'No tasks in this project',
                noTasksAtStatus: 'No tasks',
                owner: 'Owner',
                progress: 'Progress',
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
            thinking: 'Thinking...',
            send: 'Send message to {{name}}...',
            noAgent: {
                title: '😔 Sorry',
                description: 'This Agent seems to be lost...',
            }
        },
        settings: {
            title: 'System Settings',
            description: 'Configure the settings for the application',
            saveButton: 'Save',
            saved: 'Settings saved',
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
                        llmSDKNotif: 'SDK change will only take effect after service restart',
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
                prompt: 'Language',
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
                    plan: 'Plan (Plan for projects rather than doing)',
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
                sdk: {
                    prompt: 'LLM SDK',
                    options: {
                        openai: 'OpenAI',
                        anthropic: 'Anthropic',
                    },
                },
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
};
