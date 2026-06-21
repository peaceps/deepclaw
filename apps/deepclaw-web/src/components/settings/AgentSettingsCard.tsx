'use client';

import {
  CircleAlert,
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
import {AgentSettingsHeader} from './AgentSettingsHeader';
import { AgentSettingsSection } from './AgentSettingsSection';

type AgentConfig = NonNullable<DeepclawConfig['agents'][0]>;
type IMConfig = NonNullable<AgentConfig['im']>;
type LLMConfig = AgentConfig['llm'];

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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <DeepSelect
                  uiInfo={configEvents['agents.im.engine'] as Extract<AgentInteractionEvent, {type: 'select'}>}
                  value={agent.im!.engine}
                  onSelect={(e) => onUpdateIM(index, { engine: e.target.value as IMConfig['engine'] })}
                  error={hasFieldError('im.engine')}
                />
              </div>
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
              uiInfo={configEvents['agents.llm.sdk'] as Extract<AgentInteractionEvent, {type: 'select'}>}
              value={agent.llm.sdk}
              onSelect={(e) => onUpdateLLM(index, { sdk: e.target.value })}
              error={hasFieldError('llm.sdk')}
              Icon={CircleAlert}
              iconTitle='pages.settings.panels.agents.sections.llmSDKNotif'
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
              uiInfo={configEvents['agents.llm.baseURL'] as Extract<AgentInteractionEvent, {type: 'input'}>}
              value={agent.llm.baseURL}
              onInput={(e) => onUpdateLLM(index, { baseURL: e.target.value })}
              placeholder="https://api.openai.com/v1"
              error={hasFieldError('llm.baseURL')}
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
