export const zh = {
    config: {
        hint: '您的程序配置不完整，Deepclaw将引导您初始化程序配置，按回车继续...',
        ui: {
            lang: {
                prompt: '选择您的语言:',
                options: {
                    en: 'English',
                    zh: '简体中文',
                },
            },
        },
        agents: {
            index: {
                prompt: '请完成Agent {{name}}的配置...',
            },
            name: {
                prompt: '给这个Agent起个名字吧：',
            },
            mode: {
                prompt: '使用什么模式？',
                options: {
                    agent: 'Agent (可以操作电脑，拥有完整权限)',
                    plan: 'Plan (只作规划，不实际操作电脑)',
                    chat: 'Chat (只聊天)',
                },
            },
            standaloneTask: {
                prompt: '请选择独立任务的工作模式：',
                options: {
                    transient: '临时 （不保存在磁盘上）',
                    persistent: '永久 （保存在磁盘上）',
                    ask: '每次询问',
                },
            },
            headlessEnabled: {
                prompt: '是否使用headless模式并接入即时通讯软件？',
            },
            im: {
                engine: {
                    prompt: '选择通讯工具:',
                    options: {
                        dingtalk: '钉钉',
                        feishu: '飞书',
                    },
                },
                appId: {
                    prompt: '请输入App ID:',
                },
                secret: {
                    prompt: '请输入Secret:',
                }
            },
            llm: {
                sdk: {
                    prompt: '请选择您的LLM SDK：',
                    options: {
                        openai: 'OpenAI',
                        anthropic: 'Anthropic',
                    },
                },
                baseURL: {
                    prompt: '请输入Base URL：',
                },
                apiKey: {
                    prompt: '请输入API key：',
                },
                model: {
                    prompt: '请输入模型名称：',
                },
            }
        },
    },
};
