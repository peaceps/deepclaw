'use client';

import { useState, useCallback } from 'react';
import type { CONFIGS_EVENTS, DeepclawConfig} from '@deepclaw/config';
import { type AgentInteractionEvent } from '@deepclaw/core';
import { Save, Plus, Bot, Globe } from 'lucide-react';
import { AgentSettingsCard } from './AgentSettingsCard';
import {validateConfig, type ValidationResult} from '@/server/configs';
import {DeepExpandablePanel} from '@/laf/deep-expandable-panel';
import {DeepSelect} from '@/laf/deep-select';
import {DeepInput} from '@/laf/deep-input';
import {SettingsError} from './SettingsError';
import { useTranslation } from 'react-i18next';

type AgentConfig = NonNullable<DeepclawConfig['agents'][0]>;
type IMConfig = NonNullable<AgentConfig['im']>;
type LLMConfig = AgentConfig['llm'];

export type SettingsProps = {
  configEvents: CONFIGS_EVENTS;
  initialConfig: DeepclawConfig;
  initialValidation: ValidationResult;
  onSave: (config: DeepclawConfig) => void;
};

export function SettingsForm({settings}: {settings: SettingsProps}) {
  const { configEvents, initialConfig, initialValidation, onSave } = settings;
  const {t} = useTranslation();
  const [config, setConfig] = useState<DeepclawConfig>(initialConfig);
  const [savedMessage, setSavedMessage] = useState<string>('');
  const [validationResult, setValidationResult] = useState<ValidationResult>(initialValidation);
  const [panelToggleStatus, setPanelToggleStatus] = useState<ValidationResult['panelState']>(initialValidation.panelState);

  const togglePanel = useCallback((name: string) => {
    setPanelToggleStatus(pre => ({...pre, [name]: !pre[name]}));
  }, []);

  const updateUIConfig = useCallback((updates: Partial<DeepclawConfig['ui']>) => {
    setConfig((prev) => ({ ...prev, ui: { ...prev.ui, ...updates } }));
  }, []);

  const updateManagerConfig = useCallback((updates: Partial<DeepclawConfig['manager']>) => {
    setConfig((prev) => ({ ...prev, manager: { ...prev.manager, ...updates } }));
  }, []);

  const addAgent = useCallback(() => {
    const newAgent = {
      name: '',
      mode: '',
      llm: { baseURL: '', apiKey: '', model: '' },
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
    setConfig((prev) => ({
      ...prev,
      agents: prev.agents.map((agent, i) => i === index ? {...agent, fired: true} : agent)
    }));
    setPanelToggleStatus(pre => {
      delete pre[`agents.${index}`];
      return {...pre};
    });
  }, []);

  const validate = useCallback(async (cfg: DeepclawConfig) => {
    const validationResult: ValidationResult = await validateConfig(cfg);
    setValidationResult(validationResult);
    const isInvalid = validationResult.errors.length > 0;

    if (isInvalid) {
        setPanelToggleStatus(prev => ({...prev, ...validationResult.panelState}));
    }
    return isInvalid;
  }, []);

  const handleSave = useCallback(async (cfg: DeepclawConfig) => {
    const isInvalid = await validate(cfg);
    if (isInvalid) {
        return;
    }

    onSave(cfg);
    setSavedMessage('pages.settings.saved');
    setTimeout(() => setSavedMessage(''), 5000);
  }, [onSave, validate]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t('pages.settings.title')}</h1>
        <p className="text-gray-500 mt-1">{t('pages.settings.description')}</p>
      </div>

      <SettingsError validationResult={validationResult}/>

      <div className="mb-6 flex items-center gap-4">
        <button onClick={() => handleSave(config)} className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">
          <Save size={20} />
          {t('pages.settings.saveButton')}
        </button>
        {savedMessage && <span className="text-green-600 text-sm">{t(savedMessage)}</span>}
      </div>

      <div className="space-y-4">
        <DeepExpandablePanel
          name="ui"
          expanded={!!panelToggleStatus['ui']}
          onToggle={togglePanel}
          title="pages.settings.panels.ui.title"
          description="pages.settings.panels.ui.description"
          Icon={Globe}
        >
          <div className="p-6 border-t border-gray-200">
            <DeepSelect
                uiInfo={configEvents['ui.lang'] as Extract<AgentInteractionEvent, {type: 'select'}>}
                value={config.ui.lang}
                onSelect={e => updateUIConfig({ lang: e.target.value })}
                error={validationResult.errors.some(e => e === 'ui.lang')}
            />
          </div>
          <div className="p-6 border-t border-gray-200">
            <DeepInput
              uiInfo={configEvents['manager.name'] as Extract<AgentInteractionEvent, {type: 'input'}>}
              value={config.manager.name}
              placeholder='Deepclaw'
              onInput={(e) => updateManagerConfig({ name: e.target.value })}
            />
          </div>
          <div className="p-6 border-t border-gray-200">
            <DeepInput
              uiInfo={configEvents['manager.title'] as Extract<AgentInteractionEvent, {type: 'input'}>}
              value={config.manager.title}
              placeholder='CEO'
              onInput={(e) => updateManagerConfig({ title: e.target.value })}
            />
          </div>
        </DeepExpandablePanel>

        <DeepExpandablePanel
          name="agents"
          expanded={!!panelToggleStatus['agents']}
          onToggle={togglePanel}
          title="pages.settings.panels.agents.title"
          description="pages.settings.panels.agents.description"
          Icon={Bot}
          error={validationResult.errors.some(e => e === 'agents') ? 'config.agents.error' : ''}
        >
          <div className="p-6 border-t border-gray-200">
            <div className="space-y-4">
              {config.agents.map((agent, index) => (
                !agent.fired && <AgentSettingsCard
                  name={`agents.${index}`}
                  expanded={!!panelToggleStatus[`agents.${index}`]}
                  onToggle={togglePanel}
                  key={index}
                  agent={agent}
                  index={index}
                  removable={config.agents.filter(agent => !agent.fired).length > 1}
                  configEvents={configEvents}
                  validationErrors={validationResult.errors.filter(e => e.startsWith(`agents.${index}.`))}
                  onUpdate={updateAgent}
                  onUpdateLLM={updateAgentLLM}
                  onUpdateIM={updateAgentIM}
                  onRemove={removeAgent}
                />
              ))}
              <button onClick={addAgent} className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-500 hover:text-blue-600 transition-colors">
                <Plus size={20} />
                {t('pages.settings.panels.agents.addButton')}
              </button>
            </div>
          </div>
        </DeepExpandablePanel>
      </div>

      <div className="mt-8 flex items-center gap-4">
        <button onClick={() => handleSave(config)} className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">
          <Save size={20} />
          {t('pages.settings.saveButton')}
        </button>
        {savedMessage && <span className="text-green-600 text-sm">{t(savedMessage)}</span>}
      </div>
    </div>
  );
}
