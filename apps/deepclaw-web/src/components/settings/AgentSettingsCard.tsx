'use client';

import {
  Image as ImageIcon,
  MessageSquare,
} from 'lucide-react';
import type { CONFIGS_EVENTS, AgentConfig, IMConfig, ImageModel, LLMConfig } from '@deepclaw/config';
import type { AgentInteractionEvent } from '@deepclaw/core';
import { type ValidationResult } from '@/server/configs';
import {DeepSelect} from '@/laf/deep-select';
import {DeepInput} from '@/laf/deep-input';
import {DeepSwitch} from '@/laf/deep-switch';
import {DeepCustomHeaderExpandablePanel} from '@/laf/deep-expandable-panel';
import { useCallback } from 'react';
import {AgentSettingsHeader} from './AgentSettingsHeader';
import { AgentSettingsSection } from './AgentSettingsSection';

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
        <AgentSettingsSection title="web.pages.settings.panels.agents.sections.basic">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DeepInput
              uiInfo={configEvents['agents.name'] as Extract<AgentInteractionEvent, {type: 'input'}>}
              value={agent.name}
              onInput={(e) => onUpdate(index, { name: e.target.value })}
              error={hasFieldError('name')}
              required
            />
            <DeepSelect
              uiInfo={configEvents['agents.mode'] as Extract<AgentInteractionEvent, {type: 'select'}>}
              value={agent.mode}
              onSelect={(e) => onUpdate(index, { mode: e.target.value as AgentConfig['mode'] })}
              error={hasFieldError('mode')}
              required
            />
          </div>
        </AgentSettingsSection>

        {/* IM 配置 */}
        <div className="space-y-4 pt-4 border-t border-gray-100">
          <DeepSwitch
            label="web.pages.settings.panels.agents.sections.im"
            value={agent.im.enabled}
            onSwitch={(e) => {
              if (e.target.checked) {
                onUpdateIM(index, { enabled: true } );
              } else {
                onUpdateIM(index, { enabled: false });
              }
            }}
            Icon={MessageSquare}
          />
          {agent.im.enabled && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <DeepSelect
                  uiInfo={configEvents['agents.im.engine'] as Extract<AgentInteractionEvent, {type: 'select'}>}
                  value={agent.im!.engine}
                  onSelect={(e) => onUpdateIM(index, { engine: e.target.value as IMConfig['engine'] })}
                  error={hasFieldError('im.engine')}
                  required
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <DeepInput
                  uiInfo={configEvents['agents.im.appId'] as Extract<AgentInteractionEvent, {type: 'input'}>}
                  value={agent.im!.appId}
                  onInput={(e) => onUpdateIM(index, { appId: e.target.value })}
                  error={hasFieldError('im.appId')}
                  required
                />
                <DeepInput
                  uiInfo={configEvents['agents.im.secret'] as Extract<AgentInteractionEvent, {type: 'input'}>}
                  value={agent.im!.secret}
                  onInput={(e) => onUpdateIM(index, { secret: e.target.value })}
                  error={hasFieldError('im.secret')}
                  required
                />
              </div>
            </div>
          )}
        </div>

        {/* LLM 配置 */}
        <AgentSettingsSection title="web.pages.settings.panels.agents.sections.llm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DeepInput
              uiInfo={configEvents['agents.llm.baseURL'] as Extract<AgentInteractionEvent, {type: 'input'}>}
              value={agent.llm.baseURL}
              onInput={(e) => onUpdateLLM(index, { baseURL: e.target.value })}
              placeholder="https://api.openai.com/v1"
              error={hasFieldError('llm.baseURL')}
              required
            />
            <DeepInput
              uiInfo={configEvents['agents.llm.apiKey'] as Extract<AgentInteractionEvent, {type: 'input'}>}
              value={agent.llm.apiKey}
              onInput={(e) => onUpdateLLM(index, { apiKey: e.target.value })}
              placeholder="sk-..."
              error={hasFieldError('llm.apiKey')}
              required
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DeepInput
              uiInfo={configEvents['agents.llm.model'] as Extract<AgentInteractionEvent, {type: 'input'}>}
              value={agent.llm.model}
              onInput={(e) => onUpdateLLM(index, { model: e.target.value })}
              error={hasFieldError('llm.model')}
              required
            />
          </div>
        </AgentSettingsSection>

        {/* 生图配置 */}
        <AgentSettingsSection title="web.pages.settings.panels.agents.sections.image" Icon={ImageIcon}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DeepSelect
              uiInfo={configEvents['agents.llm.imageModel'] as Extract<AgentInteractionEvent, {type: 'select'}>}
              value={agent.llm.imageModel}
              onSelect={(e) => onUpdateLLM(index, {
                imageModel: (e.target.value || undefined) as ImageModel | undefined
              })}
              placeholder="web.pages.settings.panels.agents.imageModel.placeholder"
            />
            {/* 没选模型时不问 key，但已填的值留着，换回来还在 */}
            {agent.llm.imageModel && (
              <DeepInput
                uiInfo={configEvents['agents.llm.imageApiKey'] as Extract<AgentInteractionEvent, {type: 'input'}>}
                value={agent.llm.imageApiKey ?? ''}
                onInput={(e) => onUpdateLLM(index, { imageApiKey: e.target.value })}
                placeholder="sk-..."
              />
            )}
          </div>
        </AgentSettingsSection>
      </div>
    </DeepCustomHeaderExpandablePanel>
  );
}
