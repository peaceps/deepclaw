'use server';

import { LoopGateway } from '@deepclaw/loop-gateway';

export async function invoke(agentId: string, projectId: string, clientId: string, input: string): Promise<void> {
    return LoopGateway.invoke(agentId, projectId, clientId, input);
}

export async function resolveInteraction(loopId: string, clientId: string, answer: string): Promise<boolean> {
    return LoopGateway.resolveInteraction(loopId, clientId, answer);
}
