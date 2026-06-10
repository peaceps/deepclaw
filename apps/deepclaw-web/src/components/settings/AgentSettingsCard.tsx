'use client';

import {
  Bot,
  Settings,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Trash2,
} from 'lucide-react';
import { DeepclawConfig } from '@deepclaw/gateway';
import {
  imEngineOptions,
  agentModeOptions,
  standaloneTaskOptions,
  llmProviderOptions,
} from '@/lib/config';
import { type ValidationResult } from '@/server/configs';
import {DeepSelect} from '@/laf/deep-select';
import {DeepInput} from '@/laf/deep-input';
import {DeepSwitch} from '@/laf/deep-switch';
import {DeepCustomHeaderExpandablePanel} from '@/laf/deep-expandable-panel';

type AgentConfig = NonNullable<DeepclawConfig['agents'][0]>;
type IMConfig = NonNullable<AgentConfig['im']>;
type LLMConfig = AgentConfig['llm'];

function AgentSettingsHeader({
  name,
  agent,
  index,
  onToggle,
  expanded,
  removable,
  onRemove,
  validationErrors
}: {
  name: string;
  agent: AgentConfig;
  index: number;
  onToggle: (name: string) => void;
  expanded: boolean;
  removable: boolean;
  onRemove: (index: number) => void;
  validationErrors: ValidationResult['errors'];
}) {
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
              <h4 className="font-semibold text-gray-900">{agent.name || '未命名 Agent'}</h4>
              {validationErrors.length > 0 && (
                <span className="px-1.5 py-0.5 bg-red-100 text-red-600 text-xs rounded-full font-medium">
                  {validationErrors.length} 个错误
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="capitalize">{agentModeOptions.find(m => m.value === agent.mode)?.label}</span>
              {agent.im && (
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
            disabled={!removable}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(index);
            }}
            className="p-2 text-gray-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-gray-400 transition-colors"
            title="删除 Agent"
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

function AgentSettingsSection({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <div className="space-y-4">
      <h5 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
        <Settings size={16} className="text-gray-400" />
        {title}
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
  validationErrors: ValidationResult['errors'];
  onUpdate: (index: number, updates: Partial<AgentConfig>) => void;
  onUpdateLLM: (index: number, updates: Partial<LLMConfig>) => void;
  onUpdateIM: (index: number, updates: Partial<IMConfig>) => void;
  onRemove: (index: number) => void;
}) {

  // 获取字段的错误信息
  const getFieldError = (field: string) => {
    return validationErrors.find(e => e.field === `agents.${index}.${field}`)?.message;
  }

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
        validationErrors
      }}
    >
      <div className="p-6 border-t border-gray-200 space-y-6">
        <AgentSettingsSection title="基本信息">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DeepInput
              label="名称"
              value={agent.name}
              onInput={(e) => onUpdate(index, { name: e.target.value })}
              error={getFieldError('name')}
            />
            <DeepSelect
              label="运行模式"
              value={agent.mode}
              onSelect={(e) => onUpdate(index, { mode: e.target.value as AgentConfig['mode'] })}
              options={agentModeOptions}
              error={getFieldError('mode')}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DeepSelect
              label="独立任务模式"
              value={agent.standaloneTask}
              onSelect={(e) => onUpdate(index, { standaloneTask: e.target.value as AgentConfig['standaloneTask'] })}
              options={standaloneTaskOptions}
              error={getFieldError('standaloneTask')}
            />
          </div>
        </AgentSettingsSection>

        {/* IM 配置 */}
        <div className="space-y-4 pt-4 border-t border-gray-100">
          <DeepSwitch
            label="IM 配置"
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
                label="即时通讯工具"
                value={agent.im!.engine}
                onSelect={(e) => onUpdateIM(index, { engine: e.target.value as IMConfig['engine'] })}
                options={imEngineOptions}
                error={getFieldError('im.engine')}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <DeepInput
                  label="App ID"
                  value={agent.im!.appId}
                  onInput={(e) => onUpdateIM(index, { appId: e.target.value })}
                  error={getFieldError('im.appId')}
                />
                <DeepInput
                  label="Secret"
                  value={agent.im!.secret}
                  onInput={(e) => onUpdateIM(index, { secret: e.target.value })}
                  error={getFieldError('im.secret')}
                />
              </div>
            </div>
          )}
        </div>

        {/* LLM 配置 */}
        <AgentSettingsSection title="LLM 配置">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DeepSelect
              label="接口类型"
              value={agent.llm.provider}
              onSelect={(e) => onUpdateLLM(index, { provider: e.target.value })}
              options={llmProviderOptions}
              error={getFieldError('llm.provider')}
            />
            <DeepInput
              label="模型"
              value={agent.llm.model}
              onInput={(e) => onUpdateLLM(index, { model: e.target.value })}
              error={getFieldError('llm.model')}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DeepInput
              label="Base URL"
              value={agent.llm.baseUrl}
              onInput={(e) => onUpdateLLM(index, { baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              error={getFieldError('llm.baseUrl')}
            />
            <DeepInput
              label="API Key"
              value={agent.llm.apiKey}
              onInput={(e) => onUpdateLLM(index, { apiKey: e.target.value })}
              placeholder="sk-..."
              error={getFieldError('llm.apiKey')}
            />
          </div>
        </AgentSettingsSection>
      </div>
    </DeepCustomHeaderExpandablePanel>
  );
}
