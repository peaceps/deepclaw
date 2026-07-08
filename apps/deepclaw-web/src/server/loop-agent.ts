'use server';

import { ChatMessage } from '@deepclaw/core';
import { LoopGateway, UIChatService } from '@deepclaw/loop-gateway';

export async function invoke(agentId: string, projectId: string, browserId: string, input: string): Promise<void> {
    return LoopGateway.invoke(agentId, projectId, browserId, input);
}

export async function resolveInteraction(loopId: string, browserId: string, answer: string): Promise<boolean> {
    return LoopGateway.resolveInteraction(loopId, browserId, answer);
}

export async function pullOlderMessages(loopId: string, endMessageId?: string): Promise<ChatMessage[]> {
    return UIChatService.getOlderMessages(loopId, endMessageId);
}

export async function pullNewerMessages(loopId: string, startMessageId?: string): Promise<ChatMessage[]> {
    return UIChatService.getNewerMessages(loopId, startMessageId);
}

export async function pushChatMessage(loopId: string, browserId: string, message: ChatMessage): Promise<void> {
    LoopGateway.addMessage(loopId, browserId, message);
}

export async function updateChatMessage(loopId: string, browserId: string, id: string, text: string): Promise<void> {
    LoopGateway.updateMessage(loopId, browserId, id, text);
}
