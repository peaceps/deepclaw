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
                    plan: 'Plan (Only do the plan, won\'t do any real operation)',
                    chat: 'Chat (A chat tool, won\'t do any operation)',
                },
            },
            standaloneTask: {
                prompt: 'Choose the working mode for standalone tasks:',
                options: {
                    transient: 'Transient (Will not save on file system)',
                    persistent: 'Persistent (Will save on file system)',
                    ask: 'Ask (Alway ask user)',
                },
            },
            headlessEnabled: {
                prompt: 'Will you use the headless mode with an IM service?',
            },
            im: {
                engine: {
                    prompt: 'Which IM service will be used?',
                    options: {
                        dingtalk: 'DingTalk',
                        feishu: 'Feishu',
                    },
                },
                appId: 'Please enter the App ID:',
                secret: 'Please enter the Secret:',
            },
            llm: {
                provider: {
                    prompt: 'Which LLM provider will be used?',
                    options: {
                        openai: 'OpenAI',
                        anthropic: 'Anthropic',
                    },
                },
                baseUrl: 'Please enter the Base URL:',
                apiKey: 'Please enter the API key:',
                model: 'Please enter the LLM model name:',
            }
        },
    },
};
