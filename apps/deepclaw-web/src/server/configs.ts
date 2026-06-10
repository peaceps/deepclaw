'use server';

import {
    DeepclawConfig, loadConfig, writeAppConfig, validateAppConfig,
    type MissingAppConfig, DEFAULT_LANG
} from '@deepclaw/config';
import { revalidatePath } from 'next/cache';

export async function getLang(): Promise<string[]> {
  const lang = loadConfig<string>('ui.lang');
  return [lang, DEFAULT_LANG];
}

export async function loadCurrentConfig(): Promise<DeepclawConfig> {
  return loadConfig<DeepclawConfig>();
}

export async function saveConfig(config: DeepclawConfig): Promise<void> {
  writeAppConfig(config);
  revalidatePath('/', 'layout');
}

type ValidationError = {
  field: string;
  message: string;
};

export type ValidationResult = {
  errors: ValidationError[];
  summary: {
    uiErrorCount: number;
    agentErrorCount: number;
    affectedAgents: number;
    agentIndices: number[];
  };
  panelState: {[key: string]: boolean};
};

const validationMessageMapping: {[key: string]: string} = {
  ['ui.lang']: '请选择界面语言',
  ['agents']: '至少需要配置一个 Agent',
  ['agents.name']: 'Agent 名称不能为空',
  ['agents.mode']: '请选择运行模式',
  ['agents.standaloneTask']: '请选择独立任务模式',
  ['agents.llm.provider']: '请选择 LLM 提供商',
  ['agents.llm.baseUrl']: 'Base URL 不能为空',
  ['agents.llm.apiKey']: 'API Key 不能为空',
  ['agents.llm.model']: '模型名称不能为空',
  ['agents.im.engine']: '请选择 IM 引擎',
  ['agents.im.appId']: 'App ID 不能为空',
  ['agents.im.secret']: 'Secret 不能为空',
};

export async function validateConfig(config: Partial<DeepclawConfig>): Promise<ValidationResult> {
  const {lacks} = validateAppConfig(false, config);
  return transformValidationErrors(lacks);
}

function transformValidationErrors(missingConfigs: MissingAppConfig): ValidationResult {
  const errors: ValidationError[] = [];
  for (const config of missingConfigs) {
    if (typeof config === 'string') {
      tryAddValidationError(config);
    } else {
      for (const key of Object.keys(config)) {
        const keyConfig = config[key as keyof Partial<DeepclawConfig>]!;
        for (const i of Object.keys(keyConfig)) {
          const index = Number(i);
          for (const subKey of keyConfig[index]) {
            tryAddValidationError(subKey, key, index);
          }
        }
      }
    }
  }
  const summary = getValidationSummary(errors);
  const panelState: {[key: string]: boolean} = {};
  if (summary.uiErrorCount > 0) {
    panelState.ui = true;
  }
  if (summary.agentErrorCount > 0) {
    panelState.agents = true;
  }
  summary.agentIndices.forEach(idx => {
    panelState[`agents.${idx}`] = true;
  });
  return {
    errors,
    summary,
    panelState
  };

  function tryAddValidationError(key: string, parentKey?: string, i?: number): void {
    const msgKey = !parentKey ? key : `${parentKey}.${key}`;
    const message = validationMessageMapping[msgKey];
    if (message) {
      const field = !parentKey ? key : `${parentKey}.${i}.${key}`;
      errors.push({field, message});
    }
  }
}

function getValidationSummary(errors: ValidationError[]): ValidationResult['summary'] {
  const uiErrors = errors.filter(e => e.field.startsWith('ui.'));
  const agentErrors = errors.filter(e => e.field.startsWith('agents.'));
  const agentIndices = new Set(agentErrors.map(e => e.field.substring(7)).map(f => f.substring(0, f.indexOf('.'))).map(Number));

  return {
    uiErrorCount: uiErrors.length,
    agentErrorCount: agentErrors.length,
    affectedAgents: agentIndices.size,
    agentIndices: Array.from(agentIndices),
  };
}
