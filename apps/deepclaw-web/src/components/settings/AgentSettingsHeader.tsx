'use client';

import {
  Bot,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Trash2,
} from 'lucide-react';
import type { CONFIGS_EVENTS, DeepclawConfig } from '@deepclaw/config';
import type { AgentInteractionEvent } from '@deepclaw/core';
import { type ValidationResult } from '@/server/configs';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

type AgentConfig = NonNullable<DeepclawConfig['agents'][0]>;

export function AgentSettingsHeader({
  name,
  agent,
  index,
  onToggle,
  expanded,
  removable,
  onRemove,
  configEvents,
  validationErrors
}: {
  name: string;
  agent: AgentConfig;
  index: number;
  onToggle: (name: string) => void;
  expanded: boolean;
  removable: boolean;
  onRemove: (index: number) => void;
  configEvents: CONFIGS_EVENTS;
  validationErrors: ValidationResult['errors'];
}) {
  const {t} = useTranslation();

  const findSelectedOption = useCallback((key: string, value: string) => {
    const event = (configEvents[key] as Extract<AgentInteractionEvent, {type: 'select'}>);
    const selected = event.options.find(option => (typeof option === 'string' ? option : option.value) === value);
    return selected ? t(typeof selected === 'string' ? selected : selected.label) : '';
  }, [configEvents, t]);

  return (
      <div
        onClick={() => onToggle(name)}
        className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white">
            <Bot size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-gray-900">{agent.name || t('pages.settings.panels.agents.header.unnamed')}</h4>
              {validationErrors.length > 0 && (
                <span className="px-1.5 py-0.5 bg-red-100 text-red-600 text-xs rounded-full font-medium">
                  {validationErrors.length} {t('pages.settings.panels.agents.header.errors')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="capitalize">{findSelectedOption('agents.mode', agent.mode)}</span>
              {agent.im && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <MessageSquare size={12} />
                    {findSelectedOption('agents.im.engine', agent.im?.engine)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={!removable}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(index);
            }}
            className="p-2 text-gray-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-gray-400 transition-colors"
            title={t('pages.settings.panels.agents.removeButton')}
          >
            <Trash2 size={18} />
          </button>
          {expanded ? (
            <ChevronDown size={20} className="text-gray-400" />
          ) : (
            <ChevronRight size={20} className="text-gray-400" />
          )}
        </div>
      </div>
  )
}
