import {AgentInteractionEvent} from "@deepclaw/core";

export const APP_CONFIG_EVENTS: {[key: string]: AgentInteractionEvent} = {
    ['hint']: {
        type: 'readonly',
        content: 'config.env.hint'
    },
    ['ui.lang']: {
        key: 'lang',
        type: 'select',
        content: 'config.app.lang.prompt',
        options: [
            {label: 'config.app.lang.options.zh', value: 'zh'},
            {label: 'config.app.lang.options.en', value: 'en'},
        ],
    },
    ['agents.index']: {
        type: 'readonly',
        content: 'config.app.agentIndex.prompt'
    },
    ['agents.name']: {
        type: 'input',
        content: 'config.app.agentName.prompt',
    },
    ['agents.mode']: {
        type: 'select',
        content: 'config.app.agentMode.prompt',
        options: [
            {label: 'config.app.agentMode.options.agent', value: 'agent'},
            {label: 'config.app.agentMode.options.plan', value: 'plan'},
            {label: 'config.app.agentMode.options.chat', value: 'chat'},
        ],
    },
    ['agents.standaloneTask']: {
        type: 'select',
        content: 'config.app.agentStandaloneTask.prompt',
        options: [
            {label: 'config.app.agentStandaloneTask.options.transient', value: 'transient'},
            {label: 'config.app.agentStandaloneTask.options.persistent', value: 'persistent'},
            {label: 'config.app.agentStandaloneTask.options.ask', value: 'ask'},
        ],
    },
    ['agents.headlessEnabled']: {
        type: 'select',
        content: 'config.app.headless.prompt',
        options: [
            {label: 'common.yes', value: true},
            {label: 'common.no', value: false},
        ],
    },
    ['agents.im.engine']: {
        type: 'select',
        content: 'config.app.im.engine.prompt',
        options: [
            {label: 'config.app.im.engine.options.dingtalk', value: 'dingtalk'},
            {label: 'config.app.im.engine.options.feishu', value: 'feishu'},
        ],
    },
    ['agents.im.appId']: {
        type: 'input',
        content: 'config.app.im.appId'
    },
    ['agents.im.secret']: {
        type: 'input',
        content: 'config.app.im.secret'
    },
    ['agents.llm.provider']: {
        type: 'select',
        content: 'config.env.provider.prompt',
        options: [
            {label: 'config.env.provider.options.openai', value: 'openai'},
            {label: 'config.env.provider.options.anthropic', value: 'anthropic'},
        ],
    },
    ['agents.llm.baseUrl']: {
        type: 'input',
        content: 'config.env.baseUrl'
    },
    ['agents.llm.apiKey']: {
        type: 'input',
        content: 'config.env.apiKey'
    },
    ['agents.llm.model']: {
        type: 'input',
        content: 'config.env.model'
    }
};
