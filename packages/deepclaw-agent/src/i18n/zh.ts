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
        maxTurnReached: '超过最大迭代次数，运行中止！',
        contextTooLong: '这段对话对当前模型来说太长了，压缩之后依然超出上限。请新开一个对话，或者换一个上下文窗口更大的模型。',
        agentBreak: {
            agentStop: {
                projectCreated: {
                    llm: '项目创建好了，计划在项目自己的对话里调整。',
                    user: '项目创建好了，在看板上展开这一行就能过计划、开工。',
                },
            },
            externalInterrupt: {
                clientLost: {
                    llm: '客户端断开连接，运行中止！',
                    user: '客户端断开连接，运行中止！',
                },
                userStopped: {
                    llm: '用户停止了本次运行。',
                    user: '已停止。',
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
                stopped: '命令还没跑完就被用户停止了。',
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
                changes: `子代理没做完。它停下之前改了这些，按落到它这里的先后排——标着 (subagent)
的那些是它自己派出去的子代理做的，在那个子代理交回来的时候整批落下：
{{steps}}
它的会话已经没了，这些事再问不到它。后台命令是唯一的例外：它比子代理活得久，而且挂在这次运行名下，
用 check_all_background_command_status 就能列出来，它这会儿也可能还在往文件里写。哪些成果还有用，你自己
去磁盘上看，接着做或者重新派出去。`,
                changesCut: '（前面还有 {{count}} 处改动没列出）',
            },
            project: {
                awaitVerify: '任务{{name}}已完成，请验收成果。你可以继续让我修改输出，或者当成果令你满意时，标记任务为已验收。',
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
