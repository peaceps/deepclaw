'use server';

import {
  type DeepclawConfig, loadConfig, writeAppConfig, validateAppConfig, type MissingAppConfig,
  AgentsConfig,
} from '@deepclaw/config';
import { LoopGateway } from '@deepclaw/loop-gateway';
import { i18nInstance, SUPPORTED_LANGUAGES, type SupportedLanguage } from '@deepclaw/i18n';
import { revalidatePath } from 'next/cache';
import { IMService } from '@/im/im-service';

export async function loadCurrentConfig<T>(key?: string, defaultValue?: T): Promise<T> {
  return loadConfig<T>(key, defaultValue);
}

export async function saveFullConfig(config: DeepclawConfig): Promise<void> {
  const currentAgents = loadConfig<AgentsConfig>('agents');
  const currentAvatar = loadConfig<string>('manager.avatar');
  const merged: DeepclawConfig = {
    ...config,
    manager: { ...config.manager, avatar: currentAvatar }
  };
  writeAppConfig(merged);
  // This process read its language off the config as it started, and the browser switching its own
  // side reaches none of it. What the agents put in front of the user is worded here: the questions
  // a tool stops to ask, the permission choices under them, whatever a tool reports back.
  if (config.ui.lang && i18nInstance.language !== config.ui.lang) {
    await i18nInstance.changeLanguage(config.ui.lang);
  }
  for (const agent of config.agents) {
    if (currentAgents.some(current => current.id === agent.id)) {
        LoopGateway.updateAgentIdentity({id: agent.id, name: agent.name, fired: !!agent.fired });
    } else {
        LoopGateway.newAgentIdentity(agent.id);
    }
  }
  IMService.reset();
  LoopGateway.updateConfig(merged);
  revalidatePath('/', 'layout');
}

/**
 * A language is picked from a list rather than typed, so there is nothing half done about a pick to
 * wait for a button with. What is written is the config as it lies on disk with the language
 * replaced: the form the pick came from may be holding edits of other fields that the user has not
 * asked for yet, and a language is no reason to write those.
 */
export async function updateLanguage(lang: SupportedLanguage): Promise<void> {
  if (!SUPPORTED_LANGUAGES.includes(lang)) {
    throw new Error(`Invalid language: ${lang}`);
  }
  const config = loadConfig<DeepclawConfig>();
  writeAppConfig({...config, ui: {...config.ui, lang}});
  // The agents word what they put in front of the user out of this process, the same as after a save.
  if (i18nInstance.language !== lang) {
    await i18nInstance.changeLanguage(lang);
  }
  revalidatePath('/', 'layout');
}

export async function updateManagerAvatar(avatar: string): Promise<void> {
  if (!avatar || avatar.length > 16) {
    throw new Error('Invalid avatar');
  }
  const config = loadConfig<DeepclawConfig>();
  const next: DeepclawConfig = { ...config, manager: { ...config.manager, avatar } };
  writeAppConfig(next);
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
  const {lacks} = validateAppConfig(config);
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
