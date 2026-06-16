'use server';

import { LoopGateway, type LoopStore } from '@deepclaw/loop-gateway';
import { AgentSoulIdentity } from '@deepclaw/core';
import { revalidatePath } from 'next/cache';

export async function invoke(type: keyof LoopStore, agentId: string, input: string): Promise<string> {
  try {
    const result = await LoopGateway.invoke(type, agentId, input);
    return result;
  } catch (error) {
    console.error('Error invoking function:', error);
    throw error;
  }
}

export async function updateAgentIdentity(id: string, identity: Partial<AgentSoulIdentity> | string): Promise<void> {
  try {
    if (typeof identity === 'string') {
        LoopGateway.updateAgentDescription(id, identity);
    } else {
        LoopGateway.updateAgentIdentity(id, identity);
    }
    revalidatePath('/', 'layout');
  } catch (error) {
    // TODO Handle error revert UI
    console.error('Error saving agent identity:', error);
    throw error;
  }
}
