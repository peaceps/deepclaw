import {AgentInteractionEvent} from "@deepclaw/core";

export type CONFIGS_EVENTS = {[key: string]: AgentInteractionEvent};

export const APP_CONFIG_EVENTS: CONFIGS_EVENTS = {
    ['hint']: {
        type: 'readonly',
        content: 'config.hint'
    },
    ['ui.lang']: {
        key: 'lang',
        type: 'select',
        content: 'config.ui.lang.prompt',
        options: [
            {label: 'config.ui.lang.options.zh', value: 'zh'},
            {label: 'config.ui.lang.options.en', value: 'en'},
        ],
    },
    ['agents.index']: {
        type: 'readonly',
        content: 'config.agents.index.prompt'
    },
    ['agents.name']: {
        type: 'input',
        content: 'config.agents.name.prompt',
    },
    ['agents.mode']: {
        type: 'select',
        content: 'config.agents.mode.prompt',
        options: [
            {label: 'config.agents.mode.options.agent', value: 'agent'},
            {label: 'config.agents.mode.options.plan', value: 'plan'},
            {label: 'config.agents.mode.options.chat', value: 'chat'},
        ],
    },
    ['agents.standaloneTask']: {
        type: 'select',
        content: 'config.agents.standaloneTask.prompt',
        options: [
            {label: 'config.agents.standaloneTask.options.transient', value: 'transient'},
            {label: 'config.agents.standaloneTask.options.persistent', value: 'persistent'},
            {label: 'config.agents.standaloneTask.options.ask', value: 'ask'},
        ],
    },
    ['agents.headlessEnabled']: {
        type: 'select',
        content: 'config.agents.headlessEnabled.prompt',
        options: [
            {label: 'common.yes', value: true},
            {label: 'common.no', value: false},
        ],
    },
    ['agents.im.engine']: {
        type: 'select',
        content: 'config.agents.im.engine.prompt',
        options: [
            {label: 'config.agents.im.engine.options.dingtalk', value: 'dingtalk'},
            {label: 'config.agents.im.engine.options.feishu', value: 'feishu'},
        ],
    },
    ['agents.im.appId']: {
        type: 'input',
        content: 'config.agents.im.appId.prompt'
    },
    ['agents.im.secret']: {
        type: 'input',
        content: 'config.agents.im.secret.prompt'
    },
    ['agents.llm.provider']: {
        type: 'select',
        content: 'config.agents.llm.provider.prompt',
        options: [
            {label: 'config.agents.llm.provider.options.openai', value: 'openai'},
            {label: 'config.agents.llm.provider.options.anthropic', value: 'anthropic'},
        ],
    },
    ['agents.llm.baseUrl']: {
        type: 'input',
        content: 'config.agents.llm.baseUrl.prompt'
    },
    ['agents.llm.apiKey']: {
        type: 'input',
        content: 'config.agents.llm.apiKey.prompt'
    },
    ['agents.llm.model']: {
        type: 'input',
        content: 'config.agents.llm.model.prompt'
    }
};
