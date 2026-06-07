// DeepClaw 系统配置定义

// IM 引擎类型
export type IMEngine = 'dingtalk' | 'feishu';

// Agent 运行模式
export type AgentMode = 'agent' | 'plan' | 'chat';

// 独立任务模式
export type StandaloneTaskMode = 'transient' | 'persistent' | 'ask';

// IM 配置
export interface IMConfig {
  engine: IMEngine;
  appId: string;
  secret: string;
}

// LLM 配置
export interface LLMConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  responseApi: boolean;
  workspace?: string;
}

// Agent 配置
export interface AgentConfig {
  name: string;
  headlessEnabled: boolean;
  im?: IMConfig;
  mode: AgentMode;
  standaloneTask: StandaloneTaskMode;
  llm: LLMConfig;
}

// UI 配置
export interface UIConfig {
  lang: string;
}

// 完整配置
export interface DeepclawConfig {
  agents: AgentConfig[];
  ui: UIConfig;
}

// 默认配置
export const defaultConfig: DeepclawConfig = {
  agents: [
    {
      name: '虾米',
      headlessEnabled: false,
      mode: 'agent',
      standaloneTask: 'ask',
      llm: {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4',
        responseApi: false,
      },
    },
    {
      name: '小脑',
      headlessEnabled: true,
      im: {
        engine: 'dingtalk',
        appId: '',
        secret: '',
      },
      mode: 'agent',
      standaloneTask: 'persistent',
      llm: {
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        apiKey: '',
        model: 'deepseek-chat',
        responseApi: true,
      },
    },
  ],
  ui: {
    lang: 'zh-CN',
  },
};

// 配置存储键名
export const CONFIG_STORAGE_KEY = 'deepclaw:system:config';

// 从 localStorage 加载配置
export function loadConfig(): DeepclawConfig {
  if (typeof window === 'undefined') {
    return defaultConfig;
  }
  
  try {
    const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...defaultConfig, ...parsed };
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
  
  return defaultConfig;
}

// 保存配置到 localStorage
export function saveConfig(config: DeepclawConfig): void {
  if (typeof window === 'undefined') {
    return;
  }
  
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

// IM 引擎选项
export const imEngineOptions = [
  { value: 'dingtalk', label: '钉钉' },
  { value: 'feishu', label: '飞书' },
] as const;

// Agent 模式选项
export const agentModeOptions = [
  { value: 'agent', label: 'Agent 模式', description: '自主决策执行任务' },
  { value: 'plan', label: 'Plan 模式', description: '规划后等待确认' },
  { value: 'chat', label: 'Chat 模式', description: '仅对话不执行' },
] as const;

// 独立任务模式选项
export const standaloneTaskOptions = [
  { value: 'transient', label: 'Transient', description: '临时任务，不保存' },
  { value: 'persistent', label: 'Persistent', description: '持久化任务' },
  { value: 'ask', label: 'Ask', description: '每次询问' },
] as const;

// LLM Provider 选项
export const llmProviderOptions = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
  { value: 'azure', label: 'Azure OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'custom', label: '自定义' },
] as const;

// 语言选项
export const languageOptions = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
] as const;
