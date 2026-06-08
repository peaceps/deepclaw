'use server';

import {DeepclawConfig, LoopGateway, loadConfig, writeAppConfig} from '@deepclaw/gateway';

export async function invoke(input: string): Promise<string> {
  try {
    const result = await LoopGateway.invoke(input);
    return result;
  } catch (error) {
    console.error('Error invoking function:', error);
    throw error;
  }
}

export async function loadCurrentConfig(): Promise<DeepclawConfig> {
  const currentConfig = loadConfig<DeepclawConfig>();
  return currentConfig;
}

export async function saveConfig(config: DeepclawConfig): Promise<void> {
  await writeAppConfig(config);
}
