'use client';

import { useState, useCallback } from 'react';
import type {
    CONFIGS_EVENTS, DeepclawConfig, AgentConfig, IMConfig,
    LLMConfig, MultimodalConfig, ManagerConfig,
    AdvancedConfig
} from '@deepclaw/config';
import { type AgentInteractionEvent } from '@deepclaw/core';
import { Save, Plus, Bot, Globe, Settings } from 'lucide-react';
import { AgentSettingsCard } from './AgentSettingsCard';
import {updateLanguage, validateConfig, type ValidationResult} from '@/server/configs';
import {DeepExpandablePanel} from '@/laf/deep-expandable-panel';
import {DeepSelect} from '@/laf/deep-select';
import {DeepInput} from '@/laf/deep-input';
import {SettingsError} from './SettingsError';
import { useTranslation } from 'react-i18next';
import { type SupportedLanguage } from '@deepclaw/i18n';

export type SettingsProps = {
  metaData: {maxAgentCount: number},
  configEvents: CONFIGS_EVENTS;
  initialConfig: DeepclawConfig;
  initialValidation: ValidationResult;
  onSave: (config: DeepclawConfig) => Promise<void>;
};

export function SettingsForm({settings}: {settings: SettingsProps}) {
  const { configEvents, initialConfig, initialValidation, onSave } = settings;
  const {t, i18n} = useTranslation();
  const [edited, setEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<DeepclawConfig>(initialConfig);
  // What was written and whether it went, kept apart so a word about the language alone is not
  // read as the whole form having gone in.
  const [savedMessage, setSavedMessage] = useState<{key: string, failed?: boolean}>();
  const [validationResult, setValidationResult] = useState<ValidationResult>(initialValidation);
  const [panelToggleStatus, setPanelToggleStatus] = useState<ValidationResult['panelState']>(initialValidation.panelState);

  const togglePanel = useCallback((name: string) => {
    setPanelToggleStatus(pre => ({...pre, [name]: !pre[name]}));
  }, []);

  const setLang = useCallback((lang: SupportedLanguage) => {
    setConfig((prev) => ({ ...prev, ui: { ...prev.ui, lang } }));
    i18n.changeLanguage(lang);
  }, [i18n]);

  /**
   * The field was read as missing when the page came in, which on a first visit it is. A pick that
   * reached the disk is not missing any more, and nothing else is spoken for: the other fields have
   * not been through the button, so what was said about them still stands.
   */
  const clearLangError = useCallback(() => {
    setValidationResult(prev => {
      if (!prev.errors.includes('ui.lang')) {
        return prev;
      }
      const errors = prev.errors.filter(e => e !== 'ui.lang');
      return {
        ...prev,
        errors,
        summary: {...prev.summary, uiErrorCount: errors.filter(e => e.startsWith('ui.')).length},
      };
    });
  }, []);

  /**
   * A language is picked from a list rather than typed, so it is stored as it is picked: the button
   * is there for the fields still being filled in, and whether any of those are waiting on it is
   * left as it was. A pick that never reached the disk is taken back, so that what the page is read
   * in is what a reload would bring back.
   */
  const selectLanguage = useCallback(async (lang: SupportedLanguage) => {
    const previous = config.ui.lang;
    setLang(lang);
    try {
      await updateLanguage(lang);
      clearLangError();
      setSavedMessage({key: 'web.pages.settings.langSaved'});
    } catch (e) {
      // TODO change to logger
      console.error(e);
      setLang(previous);
      setSavedMessage({key: 'web.pages.settings.langSaveFailed', failed: true});
    } finally {
      setTimeout(() => setSavedMessage(undefined), 5000);
    }
  }, [clearLangError, config.ui.lang, setLang]);

  const updateManagerConfig = useCallback((updates: Partial<ManagerConfig>) => {
    setConfig((prev) => ({ ...prev, manager: { ...prev.manager, ...updates } }));
    setEdited(true);
  }, []);

  const updateAdvancedConfig = useCallback((updates: Partial<AdvancedConfig>) => {
    setConfig((prev) => ({ ...prev, advanced: { ...prev.advanced, ...updates } }));
    setEdited(true);
  }, []);

  const addAgent = useCallback(() => {
    const newAgent = {
      id: crypto.randomUUID(),
      name: '',
      mode: '',
      llm: { baseURL: '', apiKey: '', model: '' },
      multimodal: {},
      im: {enabled: false}
    } as unknown as AgentConfig;
    setConfig((prev) => ({ ...prev, agents: [...prev.agents, newAgent] }));
    setPanelToggleStatus(pre => ({...pre, [`agents.${config.agents.length}`]: true}));
    setEdited(true);
  }, [config.agents.length]);

  const updateAgent = useCallback((index: number, updates: Partial<AgentConfig>) => {
    setConfig((prev) => ({
      ...prev,
      agents: prev.agents.map((agent, i) => (i === index ? { ...agent, ...updates } : agent)),
    }));
    setEdited(true);
  }, []);

  const updateAgentLLM = useCallback((index: number, updates: Partial<LLMConfig>) => {
    setConfig((prev) => ({
      ...prev,
      agents: prev.agents.map((agent, i) =>
        i === index ? { ...agent, llm: { ...agent.llm, ...updates } } : agent
      ),
    }));
    setEdited(true);
  }, []);

  const updateAgentMultimodal = useCallback((index: number, updates: Partial<MultimodalConfig>) => {
    setConfig((prev) => ({
      ...prev,
      agents: prev.agents.map((agent, i) =>
        i === index ? { ...agent, multimodal: { ...agent.multimodal, ...updates } } : agent
      ),
    }));
    setEdited(true);
  }, []);

  const updateAgentIM = useCallback((index: number, updates: Partial<IMConfig>) => {
    setConfig((prev) => ({
      ...prev,
      agents: prev.agents.map((agent, i) =>
        i === index
          ? { ...agent, im: { ...agent.im, ...updates }}
          : agent
      ),
    }));
    setEdited(true);
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
    setEdited(true);
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
    if (saving) {
      return;
    }
    setSaving(true);
    try {
      const isInvalid = await validate(cfg);
      if (isInvalid) {
          return;
      }
      await onSave(cfg);
      setSavedMessage({key: 'web.pages.settings.saved'});
      setEdited(false);
    } catch (e) {
      // TODO change to logger
      console.error(e);
      setSavedMessage({key: 'web.pages.settings.saveFailed', failed: true});
    } finally {
      setSaving(false);
      setTimeout(() => setSavedMessage(undefined), 5000);
    }
  }, [onSave, saving, validate]);

  const savedMessageClass = savedMessage?.failed ? 'text-red-600' : 'text-green-600';
  const saveButtonDisabled = !edited || saving;
  const saveButtonClass = `flex items-center gap-2 px-6 py-3 rounded-lg transition-colors font-medium ${
    saveButtonDisabled
      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
      : 'bg-blue-600 text-white hover:bg-blue-700'
  }`;

  const maxAgentReached = config.agents.filter(agent => !agent.fired).length >= settings.metaData.maxAgentCount;
  const newAgentClass = `w-full flex items-center justify-center gap-2 px-4 py-3 border-2 transition-colors border-dashed 
rounded-lg ${maxAgentReached ? "border-gray-100 text-gray-300 cursor-not-allowed" : "border-gray-300 text-gray-500 hover:border-blue-500 hover:text-blue-600"}`;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t('web.pages.settings.title')}</h1>
        <p className="text-gray-500 mt-1">{t('web.pages.settings.description')}</p>
      </div>

      <SettingsError validationResult={validationResult}/>

      <div className="mb-6 flex items-center gap-4">
        <button onClick={() => handleSave(config)} disabled={saveButtonDisabled}
          className={saveButtonClass}>
          <Save size={20} />
          {t('web.pages.settings.saveButton')}
        </button>
        {savedMessage && <span className={`${savedMessageClass} text-sm`}>{t(savedMessage.key)}</span>}
      </div>

      <div className="space-y-4">
        <DeepExpandablePanel
          name="ui"
          expanded={!!panelToggleStatus['ui']}
          onToggle={togglePanel}
          title="web.pages.settings.panels.ui.title"
          description="web.pages.settings.panels.ui.description"
          Icon={Globe}
        >
          <div className="p-6 border-t border-gray-200">
            <DeepSelect
                uiInfo={configEvents['ui.lang'] as Extract<AgentInteractionEvent, {type: 'select'}>}
                value={config.ui.lang}
                onSelect={e => {
                  selectLanguage(e.target.value as SupportedLanguage);
                }}
                error={validationResult.errors.some(e => e === 'ui.lang')}
                required
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
          title="web.pages.settings.panels.agents.title"
          description="web.pages.settings.panels.agents.description"
          Icon={Bot}
          error={validationResult.errors.some(e => e === 'agents') ? 'web.config.agents.error' : ''}
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
                  onUpdateMultimodal={updateAgentMultimodal}
                  onUpdateIM={updateAgentIM}
                  onRemove={removeAgent}
                />
              ))}
              <button onClick={addAgent} disabled={maxAgentReached} className={newAgentClass}>
                <Plus size={20} />
                {t('web.pages.settings.panels.agents.addButton')}
              </button>
            </div>
          </div>
        </DeepExpandablePanel>

        <DeepExpandablePanel
          name="advanced"
          expanded={!!panelToggleStatus['advanced']}
          onToggle={togglePanel}
          title="web.pages.settings.panels.advanced.title"
          description="web.pages.settings.panels.advanced.description"
          Icon={Settings}
        >
          <div className="p-6 border-t border-gray-200">
            <DeepInput
              uiInfo={configEvents['advanced.mcpServer'] as Extract<AgentInteractionEvent, {type: 'input'}>}
              value={config.advanced.mcpServer ?? ''}
              placeholder={t('web.pages.settings.panels.advanced.mcpServer.placeholder')}
              onInput={(e) => updateAdvancedConfig({ mcpServer: e.target.value })}
            />
          </div>
        </DeepExpandablePanel>
      </div>

      <div className="mt-8 flex items-center gap-4">
        <button onClick={() => handleSave(config)} disabled={saveButtonDisabled}
          className={saveButtonClass}>
          <Save size={20} />
          {t('web.pages.settings.saveButton')}
        </button>
        {savedMessage && <span className={`${savedMessageClass} text-sm`}>{t(savedMessage.key)}</span>}
      </div>
    </div>
  );
}
