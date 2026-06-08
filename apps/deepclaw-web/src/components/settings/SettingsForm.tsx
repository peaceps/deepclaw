'use client';

import { useState, useCallback, useEffect } from 'react';
import { DeepclawConfig } from '@deepclaw/gateway';
import { languageOptions } from '@/lib/config';
import { Save, Plus, Bot, Globe } from 'lucide-react';
import { AgentSettingsCard } from './AgentSettingsCard';
import {validateConfig, ValidationResult} from '@/server/configs';
import {DeepExpandablePanel} from '@/laf/deep-expandable-panel';
import {DeepSelect} from '@/laf/deep-select';
import {SettingsError} from './SettingsError';

type AgentConfig = NonNullable<DeepclawConfig['agents'][0]>;
type IMConfig = NonNullable<AgentConfig['im']>;
type LLMConfig = AgentConfig['llm'];

export function SettingsForm({ initialConfig, onSave }: {
  initialConfig: DeepclawConfig;
  onSave: (config: DeepclawConfig) => void;
}) {
  const [config, setConfig] = useState<DeepclawConfig>(initialConfig);
  const [panelToggleStatus, setPanelToggleStatus] = useState<{[key: string]: boolean}>({});
  const [savedMessage, setSavedMessage] = useState<string>('');
  const [validationResult, setValidationResult] = useState<ValidationResult>({errors: [], summary: {
    uiErrorCount: 0, agentErrorCount: 0, affectedAgents: 0, agentIndices: []
  }});

  const togglePanel = useCallback((name: string) => {
    setPanelToggleStatus(pre => ({...pre, [name]: !pre[name]}));
  }, []);

  const updateUIConfig = useCallback((updates: Partial<DeepclawConfig['ui']>) => {
    setConfig((prev) => ({ ...prev, ui: { ...prev.ui, ...updates } }));
  }, []);

  const addAgent = useCallback(() => {
    const newAgent = {
      name: '',
      mode: '',
      standaloneTask: '',
      llm: { provider: '', baseUrl: '', apiKey: '', model: '', responseApi: true },
    } as unknown as AgentConfig;
    setConfig((prev) => ({ ...prev, agents: [...prev.agents, newAgent] }));
    setPanelToggleStatus(pre => ({...pre, [`agents.${config.agents.length}`]: true}));
  }, [config.agents.length]);

  const updateAgent = useCallback((index: number, updates: Partial<AgentConfig>) => {
    setConfig((prev) => ({
      ...prev,
      agents: prev.agents.map((agent, i) => (i === index ? { ...agent, ...updates } : agent)),
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
          ? { ...agent, im: agent.im ? { ...agent.im, ...updates } : { engine: '' as 'dingtalk' | 'feishu', appId: '', secret: '', ...updates } }
          : agent
      ),
    }));
  }, []);

  const removeAgent = useCallback((index: number) => {
    setConfig((prev) => ({ ...prev, agents: prev.agents.filter((_, i) => i !== index) }));
    setPanelToggleStatus(pre => {
      delete pre[`agents.${index}`];
      return {...pre};
    })
  }, []);

  const validate = useCallback(async (cfg: DeepclawConfig) => {
    const validationResult: ValidationResult = await validateConfig(cfg);
    setValidationResult(validationResult);
    const isInvalid = validationResult.errors.length > 0;

    if (isInvalid) {
      const summary = validationResult.summary;
      setPanelToggleStatus(prev => {
        if (summary.uiErrorCount > 0) {
          prev['ui'] = true;
        }
        if (summary.agentErrorCount > 0) {
          prev['agents'] = true;
        }
        summary.agentIndices.forEach(idx => {
          prev[`agents.${idx}`] = true;
        })
        return {...prev};
      })
    }
    return isInvalid;
  }, []);

  const handleSave = useCallback(async () => {
    const isInvalid = await validate(config);
    if (isInvalid) {
      return;
    }

    onSave(config);
    setSavedMessage('设置已保存');
    setTimeout(() => setSavedMessage(''), 3000);
  }, [config, onSave]);

  useEffect(() => {
    validate(config);
  }, []);

  const uiLangError = validationResult.errors.find(e => e.field === 'ui.lang');
  const agentsError = validationResult.errors.find(e => e.field === 'agents');

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">系统设置</h1>
        <p className="text-gray-500 mt-1">配置 DeepClaw 的各项参数</p>
      </div>

      <SettingsError validationResult={validationResult}/>

      <div className="mb-6 flex items-center gap-4">
        <button onClick={handleSave} className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">
          <Save size={20} />
          保存设置
        </button>
        {savedMessage && <span className="text-green-600 text-sm">{savedMessage}</span>}
      </div>

      <div className="space-y-4">
        <DeepExpandablePanel
          name="ui"
          expanded={!!panelToggleStatus['ui']}
          onToggle={togglePanel}
          title="界面设置"
          description="语言和其他 UI 配置"
          Icon={Globe}
        >
          <div className="p-6 border-t border-gray-200">
            <DeepSelect
              label="界面语言"
              value={config.ui.lang}
              onSelect={e => updateUIConfig({ lang: e.target.value })}
              options={languageOptions}
              error={uiLangError?.message}
            />
          </div>
        </DeepExpandablePanel>

        <DeepExpandablePanel
          name="agents"
          expanded={!!panelToggleStatus['agents']}
          onToggle={togglePanel}
          title="Agent 管理"
          description="配置 AI 员工的参数"
          Icon={Bot}
          error={agentsError?.message}
        >
          <div className="p-6 border-t border-gray-200">
            <div className="space-y-4">
              {config.agents.map((agent, index) => (
                <AgentSettingsCard
                  name={`agents.${index}`}
                  expanded={!!panelToggleStatus[`agents.${index}`]}
                  onToggle={togglePanel}
                  key={index}
                  agent={agent}
                  index={index}
                  removable={config.agents.length > 1}
                  validationErrors={validationResult.errors.filter(e => e.field.startsWith(`agents.${index}.`))}
                  onUpdate={updateAgent}
                  onUpdateLLM={updateAgentLLM}
                  onUpdateIM={updateAgentIM}
                  onRemove={removeAgent}
                />
              ))}
              <button onClick={addAgent} className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-500 hover:text-blue-600 transition-colors">
                <Plus size={20} />
                添加 Agent
              </button>
            </div>
          </div>
        </DeepExpandablePanel>
      </div>

      <div className="mt-8 flex items-center gap-4">
        <button onClick={handleSave} className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">
          <Save size={20} />
          保存设置
        </button>
        {savedMessage && <span className="text-green-600 text-sm">{savedMessage}</span>}
      </div>
    </div>
  );
}
