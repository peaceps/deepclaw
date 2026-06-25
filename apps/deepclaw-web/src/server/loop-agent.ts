'use server';

import { LoopGateway } from '@deepclaw/loop-gateway';

export async function invoke(agentId: string, projectId: string, input: string): Promise<string> {
  try {
    const result = await LoopGateway.invoke(agentId, projectId, input);
    return result;
  } catch (error) {
    console.error('Error invoking function:', error);
    throw error;
  }
}
