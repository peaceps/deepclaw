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
                    user: '任务{{name}}已完成，请验收成果。你可以继续让我修改输出，或者当成果令你满意时，标记任务为已验证。',
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
                allow: '允许',
                deny: '拒绝',
            },
            file: {
                guard: 'Deepclaw想要访问当前工作区外的文件。',
                write: '写入文件{{path}}成功，共{{length}}字节。',
                edit: '编辑文件{{path}}成功。',
            },
            syncCommand: {
                guard: {
                    danger: '禁止执行危险命令({{command}})。',
                    warn: '检测到危险命令({{command}})。',
                    mode: 'Deepclaw未运行在agent模式，但模型想要运行命令({{command}})。',
                },
                empty: '（无输出内容）',
                error: '出错了。{{message}}。',
                timeout: '命令运行{{timeout}}秒超时。',
            },
            project: {
                taskSteps: {
                    empty: '没有步骤。',
                    current: '\n当前步骤：\n{{steps}}\n',
                    completed: '({{completed}}/{{total}} 已完成)',
                },
            }
        },
    },
};
