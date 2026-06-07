'use client';

import { useState, useCallback } from 'react';
import {
  DeepclawConfig,
  AgentConfig,
  LLMConfig,
  IMConfig,
  imEngineOptions,
  agentModeOptions,
  standaloneTaskOptions,
  llmProviderOptions,
  languageOptions,
} from '@/lib/config';
import {
  Save,
  Plus,
  Trash2,
  Bot,
  Settings,
  Globe,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Cpu,
} from 'lucide-react';

interface SettingsFormProps {
  initialConfig: DeepclawConfig;
  onSave: (config: DeepclawConfig) => void;
}

type SectionType = 'ui' | 'agents';

function SectionHeader({toggleSection, section, title, description, expandedSections, Icon}: any) {
  // Icon is passed in as a component from lucide-react (e.g., Settings, Globe, Bot)
  return <button
      onClick={() => toggleSection(section)}
      className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
          <Icon size={20} className="text-blue-600" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <p className="text-sm text-gray-500">{description}</p>
        </div>
      </div>
      {expandedSections.has(section) ? (
        <ChevronDown size={20} className="text-gray-400" />
      ) : (
        <ChevronRight size={20} className="text-gray-400" />
      )}
    </button>
}

export function SettingsForm({ initialConfig, onSave }: SettingsFormProps) {
  const [config, setConfig] = useState<DeepclawConfig>(initialConfig);
  const [expandedSections, setExpandedSections] = useState<Set<SectionType>>(new Set(['ui']));
  const [expandedAgents, setExpandedAgents] = useState<Set<number>>(new Set([0]));
  const [savedMessage, setSavedMessage] = useState<string>('');

  const toggleSection = useCallback((section: SectionType) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  }, []);

  const toggleAgent = useCallback((index: number) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const updateUIConfig = useCallback((updates: Partial<DeepclawConfig['ui']>) => {
    setConfig((prev) => ({
      ...prev,
      ui: { ...prev.ui, ...updates },
    }));
  }, []);

  const addAgent = useCallback(() => {
    const newAgent: AgentConfig = {
      name: `Agent ${config.agents.length + 1}`,
      headlessEnabled: false,
      mode: 'agent',
      standaloneTask: 'ask',
      llm: {
        provider: 'openai',
        baseUrl: '',
        apiKey: '',
        model: '',
        responseApi: false,
      },
    };
    setConfig((prev) => ({
      ...prev,
      agents: [...prev.agents, newAgent],
    }));
    setExpandedAgents((prev) => new Set([...prev, config.agents.length]));
  }, [config.agents.length]);

  const updateAgent = useCallback((index: number, updates: Partial<AgentConfig>) => {
    setConfig((prev) => ({
      ...prev,
      agents: prev.agents.map((agent, i) =>
        i === index ? { ...agent, ...updates } : agent
      ),
    }));
  }, []);

  const updateAgentLLM = useCallback((index: number, updates: Partial<LLMConfig>) => {
    setConfig((prev) => ({
      ...prev,
      agents: prev.agents.map((agent, i) =>
        i === index ? { ...agent, llm: { ...agent.llm, ...updates } } : agent
      ),
    }));
  }, []);

  const updateAgentIM = useCallback((index: number, updates: Partial<IMConfig>) => {
    setConfig((prev) => ({
      ...prev,
      agents: prev.agents.map((agent, i) =>
        i === index 
          ? { ...agent, im: agent.im ? { ...agent.im, ...updates } : { engine: 'dingtalk', appId: '', secret: '', ...updates } } 
          : agent
      ),
    }));
  }, []);

  const removeAgent = useCallback((index: number) => {
    setConfig((prev) => ({
      ...prev,
      agents: prev.agents.filter((_, i) => i !== index),
    }));
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  }, []);

  const handleSave = useCallback(() => {
    console.log('Settings saved:', config);
    onSave(config);
    setSavedMessage('设置已保存到控制台');
    setTimeout(() => setSavedMessage(''), 3000);
  }, [config, onSave]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">系统设置</h1>
        <p className="text-gray-500 mt-1">配置 DeepClaw 的各项参数</p>
      </div>

      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
        >
          <Save size={20} />
          保存设置
        </button>
        {savedMessage && (
          <span className="text-green-600 text-sm">{savedMessage}</span>
        )}
      </div>

      <div className="space-y-4">
        {/* UI Settings */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <SectionHeader
            section="ui"
            toggleSection={toggleSection}
            expandedSections={expandedSections}
            Icon={Globe}
            title="界面设置"
            description="语言和其他 UI 配置"
          />
          {expandedSections.has('ui') && (
            <div className="p-6 border-t border-gray-200">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  界面语言
                </label>
                <select
                  value={config.ui.lang}
                  onChange={(e) => updateUIConfig({ lang: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                >
                  {languageOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Agent Settings */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <SectionHeader
            section="agents"
            Icon={Bot}
            toggleSection={toggleSection}
            expandedSections={expandedSections}
            title="Agent 管理"
            description="配置 AI 员工的参数"
          />
          {expandedSections.has('agents') && (
            <div className="p-6 border-t border-gray-200">
              <div className="space-y-4">
                {config.agents.map((agent, index) => (
                  <AgentCard
                    key={index}
                    agent={agent}
                    index={index}
                    isExpanded={expandedAgents.has(index)}
                    onToggle={() => toggleAgent(index)}
                    onUpdate={updateAgent}
                    onUpdateLLM={updateAgentLLM}
                    onUpdateIM={updateAgentIM}
                    onRemove={removeAgent}
                  />
                ))}
                <button
                  onClick={addAgent}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-500 hover:text-blue-600 transition-colors"
                >
                  <Plus size={20} />
                  添加 Agent
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Save Button */}
      <div className="mt-8 flex items-center gap-4">
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
        >
          <Save size={20} />
          保存设置
        </button>
        {savedMessage && (
          <span className="text-green-600 text-sm">{savedMessage}</span>
        )}
      </div>
    </div>
  );
}

// Agent Card Component
interface AgentCardProps {
  agent: AgentConfig;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdate: (index: number, updates: Partial<AgentConfig>) => void;
  onUpdateLLM: (index: number, updates: Partial<LLMConfig>) => void;
  onUpdateIM: (index: number, updates: Partial<IMConfig>) => void;
  onRemove: (index: number) => void;
}

function AgentCard({
  agent,
  index,
  isExpanded,
  onToggle,
  onUpdate,
  onUpdateLLM,
  onUpdateIM,
  onRemove,
}: AgentCardProps) {
  const hasIM = !!agent.im;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Agent Header */}
      <div
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white">
            <Bot size={20} />
          </div>
          <div>
            <h4 className="font-semibold text-gray-900">{agent.name || '未命名 Agent'}</h4>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="capitalize">{agentModeOptions.find(m => m.value === agent.mode)?.label}</span>
              <span>·</span>
              <span>{agent.headlessEnabled ? 'Headless' : 'UI 模式'}</span>
              {hasIM && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <MessageSquare size={12} />
                    {imEngineOptions.find(e => e.value === agent.im?.engine)?.label}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(index);
            }}
            className="p-2 text-gray-400 hover:text-red-500 transition-colors"
            title="删除 Agent"
          >
            <Trash2 size={18} />
          </button>
          {isExpanded ? (
            <ChevronDown size={20} className="text-gray-400" />
          ) : (
            <ChevronRight size={20} className="text-gray-400" />
          )}
        </div>
      </div>

      {/* Agent Details */}
      {isExpanded && (
        <div className="p-6 border-t border-gray-200 space-y-6">
          {/* 基本信息 */}
          <div className="space-y-4">
            <h5 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Settings size={16} className="text-gray-400" />
              基本信息
            </h5>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  名称
                </label>
                <input
                  type="text"
                  value={agent.name}
                  onChange={(e) => onUpdate(index, { name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  运行模式
                </label>
                <select
                  value={agent.mode}
                  onChange={(e) => onUpdate(index, { mode: e.target.value as AgentConfig['mode'] })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                >
                  {agentModeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  独立任务模式
                </label>
                <select
                  value={agent.standaloneTask}
                  onChange={(e) => onUpdate(index, { standaloneTask: e.target.value as AgentConfig['standaloneTask'] })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                >
                  {standaloneTaskOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3 py-2">
              <input
                type="checkbox"
                id={`headless-${index}`}
                checked={agent.headlessEnabled}
                onChange={(e) => onUpdate(index, { headlessEnabled: e.target.checked })}
                className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor={`headless-${index}`} className="text-sm font-medium text-gray-700">
                启用 Headless 模式
              </label>
            </div>
          </div>

          {/* LLM 配置 */}
          <div className="space-y-4 pt-4 border-t border-gray-100">
            <h5 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Cpu size={16} className="text-gray-400" />
              LLM 配置
            </h5>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  提供商
                </label>
                <select
                  value={agent.llm.provider}
                  onChange={(e) => onUpdateLLM(index, { provider: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                >
                  {llmProviderOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  模型
                </label>
                <input
                  type="text"
                  value={agent.llm.model}
                  onChange={(e) => onUpdateLLM(index, { model: e.target.value })}
                  placeholder="gpt-4, claude-3-opus, deepseek-chat..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Base URL
                </label>
                <input
                  type="text"
                  value={agent.llm.baseUrl}
                  onChange={(e) => onUpdateLLM(index, { baseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  API Key
                </label>
                <input
                  type="password"
                  value={agent.llm.apiKey}
                  onChange={(e) => onUpdateLLM(index, { apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 py-2">
              <input
                type="checkbox"
                id={`responseApi-${index}`}
                checked={agent.llm.responseApi}
                onChange={(e) => onUpdateLLM(index, { responseApi: e.target.checked })}
                className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor={`responseApi-${index}`} className="text-sm font-medium text-gray-700">
                使用 Response API
              </label>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Workspace (可选)
              </label>
              <input
                type="text"
                value={agent.llm.workspace || ''}
                onChange={(e) => onUpdateLLM(index, { workspace: e.target.value || undefined })}
                placeholder="工作区路径"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
              />
            </div>
          </div>

          {/* IM 配置 */}
          <div className="space-y-4 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <h5 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <MessageSquare size={16} className="text-gray-400" />
                IM 配置
              </h5>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasIM}
                  onChange={(e) => {
                    if (e.target.checked) {
                      onUpdate(index, { im: { engine: 'dingtalk', appId: '', secret: '' } });
                    } else {
                      onUpdate(index, { im: undefined });
                    }
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            {hasIM && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    引擎
                  </label>
                  <select
                    value={agent.im!.engine}
                    onChange={(e) => onUpdateIM(index, { engine: e.target.value as IMConfig['engine'] })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                  >
                    {imEngineOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      App ID
                    </label>
                    <input
                      type="text"
                      value={agent.im!.appId}
                      onChange={(e) => onUpdateIM(index, { appId: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Secret
                    </label>
                    <input
                      type="password"
                      value={agent.im!.secret}
                      onChange={(e) => onUpdateIM(index, { secret: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}