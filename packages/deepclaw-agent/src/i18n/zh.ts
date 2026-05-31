export const zh = {
    agent: {
        maxTurnReached: '超过最大迭代次数，运行中止。\n{{finalText}}',
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
                request: '是否允许(y/n)：',
            },
            file: {
                guard: 'Deepclaw想要访问当前工作区外的文件。',
                write: '写入文件{{path}}成功，共{{length}}字节。',
                edit: '编辑文件{{path}}成功。',
            },
            shell: {
                guard: {
                    danger: '禁止执行危险命令({{command}})。',
                    warn: '检测到危险命令({{command}})。',
                    mode: 'Deepclaw未运行在agent模式，但模型想要运行shell命令({{command}})。',
                },
                empty: '（无输出内容）',
                error: '出错了。{{message}}。',
                timeout: '命令运行{{timeout}}秒超时。',
            },
            project: {
                standaloneTask: {
                    prompt: 'Agent想要创建一个独立于任何项目的任务。你想把它保存在文件系统中还是只保存在内存里？',
                    options: {
                        persistent: '保存在文件系统中',
                        transient: '只保存在内存里',
                    },
                },
                taskSteps: {
                    empty: '没有步骤。',
                    current: '\n当前步骤：\n{{steps}}\n',
                    completed: '({{completed}}/{{total}} 已完成)',
                }
            }
        },
    },
};
