// DeepClaw 系统配置定义
export type { DeepclawConfig } from '@deepclaw/gateway';

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
] as const;

// 语言选项
export const languageOptions = [
  { value: 'zh', label: '简体中文' },
  { value: 'en', label: 'English' },
] as const;
