export const en = {
    config: {
        hint: 'Your config seems to be incomplete, Deepclaw will lead you to finish the config step by step, press enter to continue...',
        ui: {
            lang: {
                prompt: 'Choose your language:',
                options: {
                    en: 'English',
                    zh: '简体中文',
                },
            },
        },
        agents: {
            index: {
                prompt: 'Please complete configuration for Agent {{name}}...',
            },
            name: {
                prompt: 'Set the name of the agent',
            },
            mode: {
                prompt: 'Choose the agent mode you prefer:',
                options: {
                    agent: 'Agent (Operate the OS, with all capability to the files on the computer)',
                    chat: 'Chat (A chat tool, won\'t do any operation)',
                },
            },
            im: {
                enabled: {
                    prompt: 'Will you use the IM service?',
                },
                engine: {
                    prompt: 'Which IM service will be used?',
                    options: {
                        dingtalk: 'DingTalk',
                        feishu: 'Feishu',
                    },
                },
                appId: {
                    prompt: 'Please enter the App ID:',
                },
                secret: {
                    prompt: 'Please enter the Secret:'
                },
            },
            llm: {
                baseURL: {
                    prompt: 'Please enter the Base URL:'
                },
                apiKey: {
                    prompt: 'Please enter the API key:'
                },
                model: {
                    prompt: 'Please enter the LLM model name:',
                },
                imageModel: {
                    prompt: 'Which model will be used to generate images?',
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
                    prompt: 'Please enter the API key for image generation:',
                },
            }
        },
        advanced: {
            mcpServer: {
                prompt: 'Please enter the MCP server address:',
            },
        },
    },
};
