import type { MissionPriority } from '@deepclaw/core';

export const zh = {
    server: {
        meta: {
            title: 'DeepClaw - 让AI为你发光',
            description: '看见你的AI在做什么',
        },
    },
    web: {
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
            } satisfies Record<MissionPriority, string>,
            notReady: '功能开发中...',
            edit: '编辑',
            add: '添加',
            cancel: '取消',
            confirm: '确认',
            send: '发送',
            ok: '确定',
            maximize: '最大化',
            restore: '还原',
        },
        toast: {
            interactionPause: {
                role: {
                    agent: 'Agent',
                    project: '项目'
                },
                title: '互动请求',
                message: '{{role}}（{{name}}）有一个互动请求'
            },
            imConnected: {
                title: 'IM连接成功',
                message: '{{data}}的即时通讯连接成功'
            },
            imConnectFailed: {
                title: 'IM连接失败',
                message: '{{data}}的即时通讯连接失败'
            }
        },
        sidebar: {
            subtitle: '一个人也可以很热闹',
            links: {
                agents: 'Agent',
                projects: '项目看板',
                cron: '定时任务',
                skills: '技能',
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
                    description: '从左侧列表中选择一个 Agent，查看其角色设定、性格特点和工作状态',
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
                        emotions: '情绪记录',
                        noEmotions: '还没有情绪记录',
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
                    currentProject: {
                        title: '当前项目',
                        noProject: '暂无进行中的项目',
                    },
                    runningTasks: {
                        title: '正在执行',
                        noTask: '当前没有正在执行的任务',
                        startedAt: '{{time}} 开始',
                        reading: '正在评审',
                    },
                    crons: {
                        title: '定时任务',
                        noTask: '还没有创建定时任务',
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
                    report: '项目报告',
                    editDescription: '改写这个项目的描述',
                    blockedBy: '前置任务：{{titles}}',
                    labels: {
                        save: '按 Enter 保存',
                    },
                    tasksUnread: '读不到这个项目的任务。把这一行收起来再打开试试。',
                    start: {
                        action: '开工',
                        hint: '让 agent 按这份计划把任务发下去',
                        running: '这个项目正在跑，等这一轮结束再开工',
                        confirm: '开工「{{title}}」？agent 会开始把上面这些任务发给子 agent，发出去就收不回来了。',
                        kickoff: '开工吧，按这份计划把可以开始的任务发下去。',
                        busy: '已开工，但 agent 正在跑上一轮，没听见这句。等它跑完，到它的聊天里再说一声。',
                        error: '已开工，但没能叫动 agent。到它的聊天里说一声。',
                        failed: '没能开工，什么都没改，可以再按一次。',
                    },
                    archive: {
                        action: '归档',
                        hint: '把项目从看板上收起来，文件仍然留在磁盘上',
                        running: '这个项目正在被推进，此时不能归档',
                        confirm: '归档「{{title}}」？它会离开看板，也不再出现在 agent 读到的项目清单里，文件仍留在磁盘上。',
                    },
                },
                task: {
                    pause: {
                        title: {
                            on: '在完成此任务后暂停',
                            off: '不会在完成此任务后暂停',
                            locked: '已暂停并等待你验收，此时不能取消暂停',
                        }
                    },
                    verified: {
                        title: {
                            on: '验收通过',
                            off: '未验收',
                        }
                    },
                    status: {
                        menu: '推进这个任务',
                        locked: '这个任务正在被执行，此时不能改它的状态',
                        ongoing: '标为进行中',
                        ongoingHint: '任务变成进行中：之后不能改派，也不能改回待办',
                        ongoingHintUnstarted: '项目就此开工，任务变成进行中：之后不能改派，也不能改回待办',
                        done: '标为完成',
                        doneHint: '它的所有步骤会一并标完',
                        doneHintPaused: '它的所有步骤会一并标完，你亲手关掉它也就算作它在等的那次验收',
                    },
                    running: '这个任务正在被执行',
                    editTitle: '重命名这个任务',
                    editDescription: '修改这个任务的描述',
                    editAssignee: '把这个任务交给其他 Agent',
                    editPriority: '改这个任务的优先级',
                    review: {
                        add: '评审人',
                        addHint: '让另一个 Agent 在这个任务关掉之前读一遍',
                        edit: '改这个任务的评审人',
                        none: '无',
                        role: '评审',
                        running: '这个任务正在被评审',
                        waived: '未评审，由你关闭',
                        report: '评审报告',
                        reportShort: '报告',
                    },
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
                stop: {
                    title: '停止',
                    stopping: '停止中...',
                    error: '停止失败。',
                    ended: '这次运行已经结束了。',
                },
                loading: '思考中...',
                emptyLLMOutput: '大模型沉默了...',
                image: {
                    upload: '上传图片',
                    tooLarge: '{{name}} 超过 {{size}}MB，已跳过。',
                    tooMany: '一条消息最多携带 {{count}} 张图片。',
                },
                noAgent: {
                    title: '😔 非常遗憾',
                    description: '这个Agent好像已经不在了...',
                },
                session: {
                    new: '新对话',
                    newConfirm: '结束当前对话，让 {{name}} 从空白上下文重新开始？结束后仍然可以回看。',
                    newConfirmAction: '开始新对话',
                    busyHint: '正在工作，先等这轮回答完。',
                    history: '历史对话',
                    loading: '加载中...',
                    empty: '还没有结束过的对话。',
                    emptyRead: '这段对话里什么都没说。',
                    noSummary: '结束时没有留下话。',
                    meta: '{{date}} · {{turns}} 轮 · {{tokens}} tokens',
                    readonly: '正在回看一段已结束的对话。',
                    backToCurrent: '返回',
                    refused: {
                        busy: 'Agent 正在工作，等这轮回答完再开新对话。',
                        backgroundCommand: '还有后台命令在运行，等它结束再开新对话。',
                        unsupported: '这个对话不能开新会话。',
                        archiveFailed: '归档没成功，当前对话原样保留，什么都没有改动，可以再试一次。',
                    },
                    error: '开新对话失败。',
                },
            },
            skills: {
                columns: {
                    name: '名称',
                    description: '描述',
                    agent: '应用给',
                    remove: '删除',
                },
                empty: '暂无可用技能',
                resetToAll: '全部 Agent',
                remove: '删除该技能',
                confirmRemove: '{{name}} 会连同文件夹里的文件一起从磁盘上删除。',
                removeMissing: '{{name}} 已不在本地，列表已刷新。',
                removeFailed: '删除 {{name}} 失败。',
                installHint: '提示：可以直接和 Agent 聊天来安装新技能，让它帮你查找并安装即可。',
            },
            tokenUsage: {
                cachedInput: '输入（缓存命中）',
                noCachedInput: '输入（缓存未命中）',
                cacheHitRate: '输入缓存命中率',
                output: '输出'
            },
            output: {
                title: '任务报告',
                download: '下载报告',
                view: '查看报告',
                fetchFailed: '文件获取失败。',
            },
            cron: {
                tip: '提示：可以直接和 Agent 聊天来创建定时任务，告诉它要执行什么以及执行周期即可。',
                empty: '暂无定时任务',
                status: {
                    running: '计划中',
                    paused: '已暂停',
                },
                creator: '创建人',
                lastRun: '上次执行',
                nextRun: '下次执行',
                schedule: '任务周期',
                prompt: '任务内容',
                actions: {
                    pause: '暂停',
                    resume: '恢复',
                    delete: '删除',
                    confirmDelete: '{{name}} 会被彻底删除，连同它已经跑过的记录。',
                },
                history: {
                    title: '执行历史',
                    empty: '暂无执行记录',
                },
            },
            settings: {
                title: '系统设置',
                description: '配置 DeepClaw 的各项参数',
                saveButton: '保存设置',
                saved: '设置已保存',
                saveFailed: '设置保存失败',
                langSaved: '语言已保存',
                langSaveFailed: '语言保存失败',
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
                        removeButton: '裁减',
                        header: {
                            unnamed: '未命名',
                            errors: '个错误'
                        },
                        sections: {
                            basic: '基本信息',
                            im: '连接即时通讯软件',
                            llm: 'LLM配置',
                            image: '多模态配置',
                        },
                        imageModel: {
                            placeholder: '<请选择图片模型>',
                        },
                        protocol: {
                            auto: '自动识别',
                        }
                    },
                    advanced: {
                        title: '高级设置',
                        description: '高级设置',
                        mcpServer: {
                            placeholder: 'http://localhost:6059/mcp',
                        },
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
                        agent: 'Agent (完整操作权限)',
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
                    protocol: {
                        prompt: 'LLM 协议',
                        options: {
                            Anthropic: 'Anthropic',
                            OpenAIChat: 'OpenAIChat',
                            OpenAIResponse: 'OpenAIResponse',
                        },
                    },
                },
                multimodal: {
                    imageModel: {
                        prompt: '图片模型',
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
                        prompt: '图片模型APIkey',
                    },
                }
            },
            advanced: {
                mcpServer: {
                    prompt: 'MCP服务器地址',
                },
            }
        },
    },
};
