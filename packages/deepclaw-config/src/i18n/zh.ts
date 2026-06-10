export const zh = {
    config: {
        app: {
            headless: {
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
                appId: '请输入App ID:',
                secret: '请输入Secret:',
            },
            lang: {
                prompt: '选择您的语言:',
                options: {
                    en: 'English',
                    zh: '简体中文',
                },
            },
            agentIndex: {
                prompt: '请完成Agent {{name}}的配置...',
            },
            agentName: {
                prompt: '给这个Agent起个名字吧：',
            },
            agentMode: {
                prompt: '使用什么模式？',
                options: {
                    agent: 'Agent (可以操作电脑，拥有完整权限)',
                    plan: 'Plan (只作规划，不实际操作电脑)',
                    chat: 'Chat (只聊天)',
                },
            },
            agentStandaloneTask: {
                prompt: '请选择独立任务的工作模式：',
                options: {
                    transient: '临时 （不保存在磁盘上）',
                    persistent: '永久 （保存在磁盘上）',
                    ask: '每次询问',
                },
            },
        },
        env: {
            hint: '您的程序配置不完整，Deepclaw将引导您初始化程序配置，按回车继续...',
            provider: {
                prompt: '请选择您的LLM接口类型：',
                options: {
                    openai: 'OpenAI',
                    anthropic: 'Anthropic',
                },
            },
            baseUrl: '请输入Base URL：',
            apiKey: '请输入API key：',
            model: '请输入模型名称：',
            responseApi: {
                prompt: '是否使用OPENAI Response API?',
                options: {
                    yes: '是',
                    no: '否',
                },
            },
        },
    },
};
