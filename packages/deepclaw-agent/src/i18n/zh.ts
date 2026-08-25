export const zh = {
    agent: {
        identity: {
            default: {
                description: '你是一个通用的Agent助手。',
                role: '万能助理',
                personalities: '温和,乐观',
                expertises: '网络搜索,代码生成',
            }
        },
        maxTurnReached: '超过最大迭代次数，运行中止！\n{{finalText}}',
        agentBreak: {
            agentStop: {
                projectCreated: {
                    llm: '项目创建好了，等待用户调整计划。',
                    user: '项目创建好了，你可以继续让我调整计划。',
                },
                taskPause: {
                    llm: '任务已经完成，等待用户验收。',
                    user: '任务{{name}}已完成，请验收成果。你可以继续让我修改输出，或者当成果令你满意时，标记任务为已验收。',
                },
            },
            externalInterrupt: {
                clientLost: {
                    llm: '客户端断开连接，运行中止！',
                    user: '客户端断开连接，运行中止！',
                },
            },
        },
        llm: {
            openai: {
                response: {
                    output: {
                        failed: '出错了。{{message}}',
                        error: '{{param}}出错了！错误码{{code}}：{{message}}。',
                        empty: '没有收到回复。',
                    },
                },
            },
        },
        tools: {
            permission: {
                request: '允许访问？',
                always: '在此对话总是允许{{group}}操作',
                allowOnce: '允许一次',
                deny: '拒绝',
                group: {
                    command: '命令执行',
                    file: '文件',
                }
            },
            file: {
                guard: 'Deepclaw想要访问当前工作区外的文件。',
                write: '写入文件{{path}}成功，共{{length}}字节。',
                edit: '编辑文件{{path}}成功。',
            },
            // 前台和后台两个命令工具共用。
            command: {
                guard: {
                    danger: '禁止执行危险命令({{command}})。',
                    warn: '检测到需要权限的命令({{command}})。',
                    mode: 'Deepclaw未运行在agent模式，但模型想要运行命令({{command}})。',
                },
            },
            syncCommand: {
                empty: '（无输出内容）',
                error: '出错了。{{message}}。',
                timeout: '命令运行{{timeout}}秒超时。',
            },
            image: {
                noKey: '没有配置生图的 API key。请在该 agent 的生图设置里填写，或设置 {{env}} 环境变量。',
                noModel: '还没有选生图模型。请在该 agent 的生图设置里选一个。',
                unsupportedModel: '暂时还不支持用 {{model}} 生图。请在该 agent 的生图设置里选一个 qwen-image、seedream 或 gpt-image 模型。',
                saved: '图片已生成。把 ![image]({{url}}) 放进回复里，图片才会出现在会话中。',
                kept: '图片已保存。把 ![image]({{url}}) 放进回复里，图片才会出现在会话中；只报文件路径的话，用户那边什么都看不到。',
                notAPicture: '按文件名看，{{path}} 不是图片。只保存 png、jpg、gif 和 webp。',
                tooLargeToKeep: '{{path}} 有 {{size}}MB，超过了单张图 {{limit}}MB 的上限。截小一点，比如只截页面的一部分而不是整页。',
                unknownImage: '找不到 {{ref}} 这张图。只能用本会话里的 dcimg:// 引用或者一个图片链接作为参考图。',
                imageTooLarge: '{{ref}} 有 {{size}}MB，超过了生图模型能接受的 {{limit}}MB。请换一张小一点的图。',
            },
            subLoop: {
                drawnImages: `子代理生成了这些图片。只有你把它放进自己的回复里，图片才会出现在会话中，子代理做什么都送不到：
{{images}}`,
            },
            project: {
                taskSteps: {
                    empty: '没有步骤。',
                    current: '\n当前步骤：\n{{steps}}\n',
                    completed: '({{completed}}/{{total}} 已完成)',
                },
                output: {
                    generatedFiles: '生成的文件',
                },
            }
        },
    },
};
