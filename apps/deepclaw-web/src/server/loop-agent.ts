'use server';

import { LoopGateway, LOOP_BUSY_ERROR } from '@deepclaw/loop-gateway';

export type InvokeResult =
  | { status: 'ok' }
  | { status: 'busy' }
  | { status: 'error' };

export async function invoke(agentId: string, projectId: string, input: string): Promise<InvokeResult> {
  try {
    await LoopGateway.invoke(agentId, projectId, input);
    return { status: 'ok' };
  } catch (error) {
    if (error instanceof Error && error.message === LOOP_BUSY_ERROR) {
      return { status: 'busy' };
    }
    console.error('Error invoking function:', error);
    return { status: 'error' };
  }
}
