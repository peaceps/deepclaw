export const zh = {
    common: {
        iam: '我是{{name}}，擅长{{expertises}}领域的工作，随时准备为您服务！',
        all: '所有',
        toggle: {
            expand: '展开',
            collapse: '收起',
        },
        priority: {
            urgent: '紧急',
            high: '高',
            medium: '中',
            low: '低',
        },
        notReady: '功能开发中...',
        edit: '编辑',
        add: '添加',
    },
    sidebar: {
        subtitle: '一个人也可以很热闹',
        links: {
            agents: '员工',
            projects: '项目看板',
            chat: '消息中心',
            org: '组织架构',
            settings: '设置',
        },
        manager: {
            changeAvatar: '更换头像',
        },
    },
    pages: {
        agents: {
            noSelection: {
                title: '请选择一个Agent查看详情',
                description: '从左侧列表中选择一个Agent员工，查看其角色设定、性格特点和工作状态',
            },
            mood: {
                happy: '心情不错',
                focused: '专注工作中',
                tired: '有点疲惫',
                confused: '有点迷茫',
                none: '神秘',
            },
            list: {
                title: 'Agent列表'
            },
            card: {
                finishedTasks: '已完成{{count}}个任务'
            },
            status: {
                busy: '忙碌',
                idle: '空闲',
                fired: '毕业',
            },
            actions: {
                praise: '表扬',
                criticize: '批评',
                more: '更多操作',
            },
            details: {
                header: {
                    projectsCompleted: '已完成项目数',
                    changeAvatar: '更换头像',
                    editRole: '编辑职位',
                },
                labels: {
                    save: '按回车保存',
                },
                personality: {
                    title: '性格',
                    emotionExpression: '情感表达',
                },
                expertises: {
                    title: '专长',
                },
                description: {
                    title: '简介',
                    noContent: '我是谁？',
                },
                workStatus: {
                    title: '工作状态',
                    currentProject: '当前项目',
                    noProject: '暂无进行中的项目',
                },
            },
            mobile: {
                returnToList: '返回列表',
                returnToDetail: '返回详情',
            }
        },
        projects: {
            title: '任务看板',
            projectList: '项目列表',
            ownerFilter: '负责人',
            search: {
                placeholder: '搜索项目名称、描述或标签...',
                noResults: '没有匹配的项目',
                clear: '清除搜索',
            },
            status: {
                todo: '未开始',
                ongoing: '进行中',
                done: '已完成',
            },
            project: {
                noTasks: '该项目暂无任务',
                noTasksAtStatus: '暂无任务',
                owner: '负责人',
                progress: '进度',
                blockedBy: '前置任务：{{titles}}',
                labels: {
                    save: '按 Enter 保存',
                },
            },
            task: {
                pause: {
                    title: {
                        on: '在完成此任务后暂停',
                        off: '不会在完成此任务后暂停',
                    }
                }
            }
        },
        chat: {
            invalidTarget: '对象未激活',
            type: {
                project: {
                    title: '项目对话',
                    emptyPrompt: '关于这个项目说点什么吧...',
                },
                agent: {
                    title: '聊天',
                    emptyPrompt: '和{{name}}聊聊吧',
                },
            },
            invoke: {
                error: '大模型发生了意外错误.'
            },
            send: '给 {{name}} 发消息...',
            busy: '{{name}} 正在忙,请稍候...',
            loading: '思考中...',
            emptyLLMOutput: '大模型沉默了...',
            noAgent: {
                title: '😔 非常遗憾',
                description: '这个Agent好像已经不在了...',
            }
        },
        settings: {
            title: '系统设置',
            description: '配置 DeepClaw 的各项参数',
            saveButton: '保存设置',
            saved: '设置已保存',
            saveFailed: '设置保存失败',
            errors: {
                total: '个配置错误，请修正后保存',
                ui: '界面设置: {{count}} 个错误',
                agents: 'Agent 设置: {{agentCount}} 个 Agent 共有 {{errorCount}} 个错误'
            },
            panels: {
                ui: {
                    title: '界面设置',
                    description: '语言和其他UI配置'
                },
                agents: {
                    title: 'Agent设置',
                    description: '配置Agent参数',
                    addButton: '雇佣新Agent',
                    removeButtonTitle: '解雇Agent',
                    removeButton: '裁员',
                    header: {
                        unnamed: '未命名',
                        errors: '个错误'
                    },
                    sections: {
                        basic: '基本信息',
                        im: 'IM配置',
                        llm: 'LLM配置',
                        llmBaseURLNotif: 'LLM protocol(OpenAI/Anthropic)的切换只有应用重启后才生效',
                    }
                }
            }
        },
    },
    config: {
        error: {
            input: '{{name}}不能为空',
            select: '请选择{{name}}'
        },
        manager: {
            name: {
                prompt: '管理员昵称'
            },
            title: {
                prompt: '管理员头衔'
            }
        },
        ui: {
            lang: {
                prompt: '语言 / Language',
                options: {
                    en: 'English',
                    zh: '简体中文',
                },
            },
        },
        agents: {
            error: '至少需要配置一个 Agent',
            name: {
                prompt: '昵称',
            },
            mode: {
                prompt: '运行模式',
                options: {
                    agent: '代理 (完整操作权限)',
                    plan: '计划',
                    chat: '聊天',
                },
            },
            im: {
                engine: {
                    prompt: '即时通讯工具',
                    options: {
                        dingtalk: '钉钉',
                        feishu: '飞书',
                    },
                },
                appId: {
                    prompt: 'App ID',
                },
                secret: {
                    prompt: 'Secret',
                },
            },
            llm: {
                baseURL: {
                    prompt: 'Base URL',
                },
                apiKey: {
                    prompt: 'API key',
                },
                model: {
                    prompt: '模型名称',
                },
            }
        },
    },
};
