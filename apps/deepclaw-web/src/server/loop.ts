'use server';

import { LoopGateway } from '@deepclaw/loop-gateway';

export async function invoke(input: string): Promise<string> {
  try {
    const result = await LoopGateway.invoke(input);
    return result;
  } catch (error) {
    console.error('Error invoking function:', error);
    throw error;
  }
}
