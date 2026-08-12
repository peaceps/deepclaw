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
                    chat: 'Chat (只聊天)',
                },
            },
            im: {
                enabled: {
                    prompt: '是否使用即时通讯软件？',
                },
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
                baseURL: {
                    prompt: '请输入Base URL：',
                },
                apiKey: {
                    prompt: '请输入API key：',
                },
                model: {
                    prompt: '请输入模型名称：',
                },
                imageModel: {
                    prompt: '用哪个模型生图？',
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
                    prompt: '请输入用于生图的 API key：',
                },
            }
        },
        advanced: {
            mcpServer: {
                prompt: '请输入MCP服务器地址：',
            },
        },
    },
};
