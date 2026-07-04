'use server';

import { LoopGateway } from "@deepclaw/loop-gateway";

export async function resolveInteraction(loopId: string, clientId: string, answer: string): Promise<boolean> {
    return LoopGateway.resolveInteraction(loopId, clientId, answer);
}
