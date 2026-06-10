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

export type ValidationResult = {
  errors: string[];
  summary: {
    uiErrorCount: number;
    agentErrorCount: number;
    affectedAgents: number;
    agentIndices: number[];
  };
  panelState: {[key: string]: boolean};
};

export async function validateConfig(config: Partial<DeepclawConfig>): Promise<ValidationResult> {
  const {lacks} = validateAppConfig(false, config);
  return transformValidationErrors(lacks);
}

function transformValidationErrors(missingConfigs: MissingAppConfig): ValidationResult {
  const errors: string[] = [];
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
      const field = !parentKey ? key : `${parentKey}.${i}.${key}`;
      errors.push(field);
  }
}

function getValidationSummary(errors: string[]): ValidationResult['summary'] {
  const uiErrors = errors.filter(e => e.startsWith('ui.'));
  const agentErrors = errors.filter(e => e.startsWith('agents.'));
  const agentIndices = new Set(agentErrors.map(e => e.substring(7)).map(f => f.substring(0, f.indexOf('.'))).map(Number));

  return {
    uiErrorCount: uiErrors.length,
    agentErrorCount: agentErrors.length,
    affectedAgents: agentIndices.size,
    agentIndices: Array.from(agentIndices),
  };
}
