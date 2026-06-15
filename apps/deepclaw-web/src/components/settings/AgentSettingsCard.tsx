'use client';

import {
  Settings,
  MessageSquare,
} from 'lucide-react';
import type { CONFIGS_EVENTS, DeepclawConfig } from '@deepclaw/config';
import type { AgentInteractionEvent } from '@deepclaw/core';
import { type ValidationResult } from '@/server/configs';
import {DeepSelect} from '@/laf/deep-select';
import {DeepInput} from '@/laf/deep-input';
import {DeepSwitch} from '@/laf/deep-switch';
import {DeepCustomHeaderExpandablePanel} from '@/laf/deep-expandable-panel';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {AgentSettingsHeader} from './AgentSettingsHeader';

type AgentConfig = NonNullable<DeepclawConfig['agents'][0]>;
type IMConfig = NonNullable<AgentConfig['im']>;
type LLMConfig = AgentConfig['llm'];

function AgentSettingsSection({title, children}: {title: string; children: React.ReactNode}) {
  const {t} = useTranslation();
  return (
    <div className="space-y-4">
      <h5 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
        <Settings size={16} className="text-gray-400" />
        {t(title)}
      </h5>
      {children}
    </div>
  )
}

export function AgentSettingsCard({
  name,
  agent,
  index,
  removable,
  configEvents,
  validationErrors,
  expanded,
  onToggle,
  onUpdate,
  onUpdateLLM,
  onUpdateIM,
  onRemove,
}: {
  name: string;
  expanded: boolean;
  onToggle: (name: string) => void;
  agent: AgentConfig;
  index: number;
  removable: boolean;
  configEvents: CONFIGS_EVENTS;
  validationErrors: ValidationResult['errors'];
  onUpdate: (index: number, updates: Partial<AgentConfig>) => void;
  onUpdateLLM: (index: number, updates: Partial<LLMConfig>) => void;
  onUpdateIM: (index: number, updates: Partial<IMConfig>) => void;
  onRemove: (index: number) => void;
}) {
  const hasFieldError = useCallback((field: string): boolean => {
    return validationErrors.some(e => e === `agents.${index}.${field}`);
  }, [validationErrors, index]);

  return (
    <DeepCustomHeaderExpandablePanel
      CustomHeader={AgentSettingsHeader}
      customHeaderProps={{
        name,
        expanded,
        onToggle,
        agent,
        index,
        removable,
        onRemove,
        configEvents,
        validationErrors
      }}
    >
      <div className="p-6 border-t border-gray-200 space-y-6">
        <AgentSettingsSection title="pages.settings.panels.agents.sections.basic">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DeepInput
              uiInfo={configEvents['agents.name'] as Extract<AgentInteractionEvent, {type: 'input'}>}
              value={agent.name}
              onInput={(e) => onUpdate(index, { name: e.target.value })}
              error={hasFieldError('name')}
            />
            <DeepSelect
              uiInfo={configEvents['agents.mode'] as Extract<AgentInteractionEvent, {type: 'select'}>}
              value={agent.mode}
              onSelect={(e) => onUpdate(index, { mode: e.target.value as AgentConfig['mode'] })}
              error={hasFieldError('mode')}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DeepSelect
              uiInfo={configEvents['agents.standaloneTask'] as Extract<AgentInteractionEvent, {type: 'select'}>}
              value={agent.standaloneTask}
              onSelect={(e) => onUpdate(index, { standaloneTask: e.target.value as AgentConfig['standaloneTask'] })}
              error={hasFieldError('standaloneTask')}
            />
          </div>
        </AgentSettingsSection>

        {/* IM 配置 */}
        <div className="space-y-4 pt-4 border-t border-gray-100">
          <DeepSwitch
            label="pages.settings.panels.agents.sections.im"
            value={!!agent.im}
            onSwitch={(e) => {
              if (e.target.checked) {
                onUpdate(index, { im: { engine: '' as 'feishu' | 'dingtalk', appId: '', secret: '' } } );
              } else {
                onUpdate(index, { im: undefined });
              }
            }}
            Icon={MessageSquare}
          />
          {agent.im && (
            <div className="space-y-4">
              <DeepSelect
                uiInfo={configEvents['agents.im.engine'] as Extract<AgentInteractionEvent, {type: 'select'}>}
                value={agent.im!.engine}
                onSelect={(e) => onUpdateIM(index, { engine: e.target.value as IMConfig['engine'] })}
                error={hasFieldError('im.engine')}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <DeepInput
                  uiInfo={configEvents['agents.im.appId'] as Extract<AgentInteractionEvent, {type: 'input'}>}
                  value={agent.im!.appId}
                  onInput={(e) => onUpdateIM(index, { appId: e.target.value })}
                  error={hasFieldError('im.appId')}
                />
                <DeepInput
                  uiInfo={configEvents['agents.im.secret'] as Extract<AgentInteractionEvent, {type: 'input'}>}
                  value={agent.im!.secret}
                  onInput={(e) => onUpdateIM(index, { secret: e.target.value })}
                  error={hasFieldError('im.secret')}
                />
              </div>
            </div>
          )}
        </div>

        {/* LLM 配置 */}
        <AgentSettingsSection title="pages.settings.panels.agents.sections.llm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DeepSelect
              uiInfo={configEvents['agents.llm.provider'] as Extract<AgentInteractionEvent, {type: 'select'}>}
              value={agent.llm.provider}
              onSelect={(e) => onUpdateLLM(index, { provider: e.target.value })}
              error={hasFieldError('llm.provider')}
            />
            <DeepInput
              uiInfo={configEvents['agents.llm.model'] as Extract<AgentInteractionEvent, {type: 'input'}>}
              value={agent.llm.model}
              onInput={(e) => onUpdateLLM(index, { model: e.target.value })}
              error={hasFieldError('llm.model')}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DeepInput
              uiInfo={configEvents['agents.llm.baseUrl'] as Extract<AgentInteractionEvent, {type: 'input'}>}
              value={agent.llm.baseUrl}
              onInput={(e) => onUpdateLLM(index, { baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              error={hasFieldError('llm.baseUrl')}
            />
            <DeepInput
              uiInfo={configEvents['agents.llm.apiKey'] as Extract<AgentInteractionEvent, {type: 'input'}>}
              value={agent.llm.apiKey}
              onInput={(e) => onUpdateLLM(index, { apiKey: e.target.value })}
              placeholder="sk-..."
              error={hasFieldError('llm.apiKey')}
            />
          </div>
        </AgentSettingsSection>
      </div>
    </DeepCustomHeaderExpandablePanel>
  );
}
