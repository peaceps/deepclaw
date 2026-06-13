'use server';

import { LoopGateway, type LoopStore } from '@deepclaw/loop-gateway';

export async function invoke(type: keyof LoopStore, agentId: string, input: string): Promise<string> {
  try {
    const result = await LoopGateway.invoke(type, agentId, input);
    return result;
  } catch (error) {
    console.error('Error invoking function:', error);
    throw error;
  }
}
